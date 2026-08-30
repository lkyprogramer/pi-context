import { describe, expect, it, vi } from "vitest";

import { blobId, domainHash } from "@pcr/contracts";
import {
  createRuntimeSession,
  createRuntimeSessionRegistry,
  RuntimeSessionRegistryError,
  type PiSessionContext,
  type RuntimeSession,
  type RuntimeSessionHandle,
} from "@pcr/runtime";

function fixtureBlobRef(sessionId: string) {
  return blobId(`blob_${domainHash("t08-blob", sessionId)}`);
}

function context(overrides: Partial<PiSessionContext> = {}): PiSessionContext {
  return {
    workspaceId: "ws-t08",
    sessionId: "session-t08",
    leafId: "leaf-t08",
    lineageHash: "8".repeat(64),
    modelKey: "openclaw/Qwen3.8-27B-WORK",
    ...overrides,
  };
}

function runtime(scope: PiSessionContext): RuntimeSession {
  return createRuntimeSession({
    scope,
    ports: {
      userInput: {
        async capture(input) {
          return {
            operationId: input.operationId,
            userTurnId: `turn-${scope.sessionId}`,
            cursor: input.cursor,
            rawTextHash: "8".repeat(64),
            rawBlobId: fixtureBlobRef(scope.sessionId),
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
            observationId: `observation-${scope.sessionId}`,
            rawBlobId: fixtureBlobRef(scope.sessionId),
            evidenceIds: [],
            visibleContent: input.content,
            isError: input.isError,
            reducer: { id: "t08", revision: "1" },
          };
        },
      },
      materialization: {
        async materialize() {
          throw new Error("not exercised by registry tests");
        },
      },
    },
  });
}

async function runT08Fixture(): Promise<{ ok: true; task: "T08" }> {
  const registry = createRuntimeSessionRegistry({
    workspaceId: "ws-t08",
    factory: {
      async create(ctx) {
        return { session: runtime(ctx), async dispose() {} };
      },
    },
  });
  const first = await registry.open(context());
  const duplicate = await registry.open(context());
  expect(duplicate).toBe(first);
  expect(registry.get("session-t08")).toBe(first);
  await registry.close("session-t08");
  return { ok: true, task: "T08" };
}

describe("T08 Production composition root and session registry", () => {
  it("production_composition_root_and_session_registry", async () => {
    await expect(runT08Fixture()).resolves.toEqual({ ok: true, task: "T08" });
  });

  it("fails construction and malformed or cross-workspace input closed", async () => {
    expect(() => createRuntimeSessionRegistry(undefined as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING" }),
    );
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: { async create(ctx) { return { session: runtime(ctx), async dispose() {} }; } },
    });
    expect(() => registry.get("missing")).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
    await expect(registry.open(context({ workspaceId: "ws-other" }))).rejects.toMatchObject({
      code: "PCR_RUNTIME_SESSION_SCOPE_CONFLICT",
    });
    await expect(registry.open(context({ lineageHash: "not-a-digest" }))).rejects.toMatchObject({
      code: "PCR_RUNTIME_SESSION_CONTEXT_INVALID",
    });
  });

  it("coalesces concurrent duplicate opens and disposes exactly once", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const dispose = vi.fn(async () => undefined);
    const create = vi.fn(async (ctx: Readonly<PiSessionContext>): Promise<RuntimeSessionHandle> => {
      await ready;
      return { session: runtime(ctx), dispose };
    });
    const registry = createRuntimeSessionRegistry({ workspaceId: "ws-t08", factory: { create } });
    const first = registry.open(context());
    const second = registry.open(context());
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(1);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(two).toBe(one);
    await Promise.all([registry.close("session-t08"), registry.close("session-t08")]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("serializes branch replacement and never exposes the closing session", async () => {
    const disposed: string[] = [];
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: {
        async create(ctx) {
          return {
            session: runtime(ctx),
            async dispose() { disposed.push(ctx.lineageHash); },
          };
        },
      },
    });
    const oldSession = await registry.open(context());
    const nextContext = context({ leafId: "leaf-next", lineageHash: "9".repeat(64) });
    const nextOpen = registry.open(nextContext);
    expect(() => registry.get("session-t08")).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
    const nextSession = await nextOpen;
    expect(nextSession).not.toBe(oldSession);
    expect(disposed).toEqual(["8".repeat(64)]);
    await expect(
      oldSession.ingestUserInput({
        operationId: "op-wrong-branch",
        cursor: nextContext,
        rawText: "wrong scope",
        sourceClass: "authenticated-user",
        capturedAt: 1,
      }),
    ).rejects.toMatchObject({ code: "PCR_RUNTIME_SCOPE_MISMATCH" });
  });

  it("leaves no partial cache after factory crash and allows a deterministic retry", async () => {
    let attempts = 0;
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: {
        async create(ctx) {
          attempts += 1;
          if (attempts === 1) throw new Error("factory-crash");
          return { session: runtime(ctx), async dispose() {} };
        },
      },
    });
    await expect(registry.open(context())).rejects.toThrowError("factory-crash");
    expect(() => registry.get("session-t08")).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
    const recovered = await registry.open(context());
    expect(registry.get("session-t08")).toBe(recovered);
    expect(attempts).toBe(2);
  });

  it("disposes a malformed factory handle before failing closed", async () => {
    const dispose = vi.fn(async () => undefined);
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: {
        async create() {
          return { session: {} as RuntimeSession, dispose };
        },
      },
    });
    await expect(registry.open(context())).rejects.toMatchObject({
      code: "PCR_RUNTIME_REGISTRY_DEPENDENCY_MISSING",
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => registry.get("session-t08")).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
  });

  it("preserves cancellation reason and disposes a handle completed after cancellation", async () => {
    const controller = new AbortController();
    let release!: () => void;
    let markEntered!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const dispose = vi.fn(async () => undefined);
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: {
        async create(ctx) {
          markEntered();
          await ready;
          return { session: runtime(ctx), dispose };
        },
      },
    });
    const reason = new Error("cancel-t08");
    const pending = registry.open(context({ signal: controller.signal }));
    await entered;
    controller.abort(reason);
    release();
    await expect(pending).rejects.toBe(reason);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => registry.get("session-t08")).toThrowError(
      expect.objectContaining({ code: "PCR_RUNTIME_SESSION_NOT_OPEN" }),
    );
  });

  it("rejects an opening session that shutdown closes and releases its eventual handle", async () => {
    let release!: () => void;
    let markEntered!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const dispose = vi.fn(async () => undefined);
    const registry = createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: {
        async create(ctx) {
          markEntered();
          await ready;
          return { session: runtime(ctx), dispose };
        },
      },
    });
    const opening = registry.open(context());
    await entered;
    const closing = registry.close("session-t08");
    release();
    await expect(opening).rejects.toMatchObject({ code: "PCR_RUNTIME_SESSION_OPEN_CANCELLED" });
    await expect(closing).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("derives equal behavior for equal inputs across independent registries", async () => {
    const makeRegistry = () => createRuntimeSessionRegistry({
      workspaceId: "ws-t08",
      factory: { async create(ctx: Readonly<PiSessionContext>) { return { session: runtime(ctx), async dispose() {} }; } },
    });
    const first = await makeRegistry().open(context());
    const second = await makeRegistry().open(context());
    const input = {
      operationId: "op-deterministic",
      cursor: context(),
      rawText: "same",
      sourceClass: "authenticated-user" as const,
      capturedAt: 8,
    };
    await expect(first.ingestUserInput(input)).resolves.toEqual(await second.ingestUserInput(input));
  });

  it("uses a stable typed error class", () => {
    expect(new RuntimeSessionRegistryError("PCR_RUNTIME_SESSION_NOT_OPEN")).toBeInstanceOf(TypeError);
  });
});
