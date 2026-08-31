import { SessionManager } from "@earendil-works/pi-coding-agent";
import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProductionCompositionRoot,
  createProductionPiContextExtension,
  derivePiSessionContext,
  type PiRuntimeContext,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

afterEach(resetOwnerForTest);

const identity = { create: createRuntimeCursor };

function fixtureBlobRef(sessionId: string) {
  return blobId(`blob_${domainHash("session-registry-blob", sessionId)}`);
}

function actualPiContext(sessionManager: SessionManager, signal = new AbortController().signal): PiRuntimeContext {
  return {
    cwd: sessionManager.getCwd(),
    sessionManager,
    model: {
      provider: "openclaw",
      id: "Qwen3.8-27B-WORK",
      contextWindow: 200_192,
      maxTokens: 16_384,
    } as PiRuntimeContext["model"],
    signal,
  };
}

function resources(disposals: string[], contexts: string[]): ProductionSessionResourcesFactory {
  return {
    async create(ctx) {
      contexts.push(`${ctx.workspaceId}:${ctx.sessionId}:${ctx.leafId ?? "header"}:${ctx.lineageHash}`);
      return {
        ports: {
          userInput: {
            async capture(input) {
              return {
                operationId: input.operationId,
                receiptId: `receipt-${ctx.sessionId}`,
                status: "pending" as const,
                cursor: input.cursor,
                rawTextHash: "a".repeat(64),
                rawBlobId: fixtureBlobRef(ctx.sessionId),
                utf8Bytes: Buffer.byteLength(input.rawText, "utf8"),
                sourceClass: input.sourceClass,
                capturedAt: input.capturedAt,
              };
            },
          },
          toolResult: {
            async ingest(input) {
              return {
                operationId: input.operationId,
                observationId: `observation-${ctx.sessionId}`,
                rawBlobId: fixtureBlobRef(ctx.sessionId),
                evidenceIds: [],
                visibleContent: input.content,
                isError: input.isError,
                reducer: { id: "acceptance-t08", revision: "1" },
              };
            },
          },
          materialization: {
            async materialize() {
              throw new Error("materialization is owned by T13");
            },
          },
        },
        async dispose() {
          disposals.push(ctx.lineageHash);
        },
      };
    },
  };
}

function host() {
  const hooks = new Map<string, (event: unknown, ctx: PiRuntimeContext) => Promise<unknown>>();
  const tools = new Set<string>();
  return {
    hooks,
    api: {
      on(name: string, handler: (event: unknown, ctx: PiRuntimeContext) => Promise<unknown>) {
        hooks.set(name, handler);
      },
      registerTool(tool: { name: string }) {
        if (tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
        tools.add(tool.name);
      },
      registerCommand() {},
      hasTool(name: string) { return tools.has(name); },
    },
  };
}

describe("production session registry acceptance", () => {
  it("derives stable identity from a real Pi 0.84.4 SessionManager without fixture IDs", () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-workspace");
    const ctx = actualPiContext(manager);
    const first = derivePiSessionContext(ctx, identity);
    const repeated = derivePiSessionContext(ctx, identity);
    expect(repeated).toEqual(first);
    expect(first.sessionId).toBe(manager.getSessionId());
    expect(first.leafId).toBeNull();
    expect(first.workspaceId).toMatch(/^ws_[a-f0-9]{40}$/u);
    expect(first.lineageHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.modelKey).toBe("openclaw/Qwen3.8-27B-WORK");

    manager.appendMessage({ role: "user", content: "real Pi branch entry" } as never);
    const advanced = derivePiSessionContext(actualPiContext(manager), identity);
    expect(advanced.leafId).toBe(manager.getLeafId());
    expect(advanced.lineageHash).not.toBe(first.lineageHash);
  });

  it("constructs a real RuntimeSession per Pi branch and releases superseded resources", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-composition");
    const disposals: string[] = [];
    const contexts: string[] = [];
    const root = createProductionCompositionRoot({ identity, resources: resources(disposals, contexts) });
    const initialContext = actualPiContext(manager);
    const initialCursor = derivePiSessionContext(initialContext, identity);
    const initial = await root.open(initialContext);
    expect(root.get(manager.getSessionId())).toBe(initial);
    await expect(root.open(initialContext)).resolves.toBe(initial);
    expect(contexts).toHaveLength(1);

    await expect(initial.ingestUserInput({
      operationId: "acceptance-user-input",
      cursor: initialCursor,
      rawText: "captured by the injected production port",
      sourceClass: "authenticated-user",
      capturedAt: 8,
    })).resolves.toMatchObject({
      operationId: "acceptance-user-input",
      cursor: initialCursor,
      sourceClass: "authenticated-user",
    });

    manager.appendMessage({ role: "user", content: "advance branch" } as never);
    const replacement = await root.open(actualPiContext(manager));
    expect(replacement).not.toBe(initial);
    expect(contexts).toHaveLength(2);
    expect(disposals).toEqual([initialCursor.lineageHash]);
    await root.close(actualPiContext(manager));
    expect(disposals).toHaveLength(2);
  });

  it("keeps a close/reopen successor reachable within the bound workspace", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-close-reopen");
    let releaseFirstDispose!: () => void;
    let markFirstDispose!: () => void;
    const firstDisposeGate = new Promise<void>((resolve) => { releaseFirstDispose = resolve; });
    const firstDisposeEntered = new Promise<void>((resolve) => { markFirstDispose = resolve; });
    let creates = 0;
    let disposals = 0;
    const factory = resources([], []);
    const root = createProductionCompositionRoot({
      identity,
      resources: {
        async create(ctx) {
          creates += 1;
          const result = await factory.create(ctx);
          const sequence = creates;
          return {
            ...result,
            async dispose() {
              disposals += 1;
              if (sequence === 1) {
                markFirstDispose();
                await firstDisposeGate;
              }
              await result.dispose();
            },
          };
        },
      },
    });
    const ctx = actualPiContext(manager);
    await root.open(ctx);
    const closing = root.close(ctx);
    await firstDisposeEntered;
    const reopening = root.open(ctx);
    releaseFirstDispose();
    await expect(closing).resolves.toBeUndefined();
    const successor = await reopening;
    expect(root.get(manager.getSessionId())).toBe(successor);
    expect(creates).toBe(2);
    expect(disposals).toBe(1);
    await root.close(ctx);
    expect(disposals).toBe(2);
  });

  it("keeps two workspaces isolated on one composition root", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-bound-workspace");
    const contexts: string[] = [];
    const root = createProductionCompositionRoot({ identity, resources: resources([], contexts) });
    const ctx = actualPiContext(manager);
    const first = await root.open(ctx);
    const second = await root.open({ ...ctx, cwd: "/tmp/pcr-t08-other-workspace" });
    expect(second).not.toBe(first);
    expect(new Set(contexts.map((row) => row.split(":")[0])).size).toBe(2);
    await root.close(ctx);
  });

  it("binds the explicit production root to actual Pi lifecycle events", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-extension");
    const pi = host();
    const disposals: string[] = [];
    const contexts: string[] = [];
    const extension = createProductionPiContextExtension(pi.api as never, {
      identity,
      resources: resources(disposals, contexts),
    });
    const ctx = actualPiContext(manager);
    expect(extension.claimed).toBe(true);
    expect(pi.hooks.get("session_start")).toEqual(expect.any(Function));
    expect(pi.hooks.get("session_tree")).toEqual(expect.any(Function));
    expect(pi.hooks.get("session_shutdown")).toEqual(expect.any(Function));

    await pi.hooks.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
    expect(contexts).toHaveLength(1);
    manager.appendMessage({ role: "user", content: "tree entry" } as never);
    await pi.hooks.get("session_tree")!({
      type: "session_tree",
      oldLeafId: null,
      newLeafId: manager.getLeafId(),
    }, actualPiContext(manager));
    expect(contexts).toHaveLength(2);
    await pi.hooks.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, actualPiContext(manager));
    expect(disposals).toHaveLength(2);
    extension.release?.();
  });

  it("fails closed before lifecycle registration when stateful resources are absent", () => {
    const pi = host();
    expect(() => createProductionPiContextExtension(pi.api as never, {} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_PRODUCTION_DEPENDENCY_MISSING" }),
    );
    expect(pi.hooks.size).toBe(0);
  });

  it("rejects an invalid identity result before opening stateful resources", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-invalid-identity");
    const create = vi.fn(async () => { throw new Error("must not run"); });
    const root = createProductionCompositionRoot({
      identity: {
        create(input) {
          return {
            workspaceId: "",
            sessionId: input.sessionId,
            leafId: input.leafId,
            lineageHash: "invalid",
            modelKey: input.modelKey,
          };
        },
      },
      resources: { create },
    });
    await expect(root.open(actualPiContext(manager))).rejects.toMatchObject({
      code: "PCR_PI_SESSION_CONTEXT_INVALID",
      details: { field: "identity.result" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates resource factory cancellation or crash without caching a session", async () => {
    const manager = SessionManager.inMemory("/tmp/pcr-t08-failure");
    const error = new Error("resource-create-crash");
    const create = vi.fn(async () => { throw error; });
    const root = createProductionCompositionRoot({ identity, resources: { create } });
    await expect(root.open(actualPiContext(manager))).rejects.toBe(error);
    expect(() => root.get(manager.getSessionId())).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
    await expect(root.open(actualPiContext(manager))).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
