import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { registerToolResultHook } from "@pcr/pi-adapter";
import { createObservationService, decodeObservation } from "@pcr/runtime";
import { createProductHarness } from "../helpers/product-harness.js";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";
import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];
const SECRET = "secret output";

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-t13-agent-session-"));
  roots.push(value);
  return value;
}

function piCursor(manager: SessionManager): RuntimeCursor {
  const branch = manager.getBranch().map((entry) => entry.id);
  return createRuntimeCursor({
    workspacePath: manager.getCwd(),
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId(),
    lineageEntryIds: branch.length > 0 ? branch : [manager.getHeader()!.id],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "openclaw",
    model: "Qwen3.8-27B-WORK",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function completedStream(text: string) {
  const message = assistantMessage(text);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      yield { type: "done" as const, message };
    },
    async result() { return message; },
  };
}

function visibleText(content: unknown): string {
  return JSON.stringify(content ?? "");
}

async function createSession(factory: ExtensionFactory, existing?: { root: string; manager: SessionManager }) {
  const root = existing?.root ?? dataRoot();
  const manager = existing?.manager ?? SessionManager.inMemory(root);
  const settings = SettingsManager.inMemory({
    defaultProvider: "openclaw",
    defaultModel: "Qwen3.8-27B-WORK",
    defaultTools: [],
  }, { projectTrusted: true });
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("openclaw", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "offline-t13-acceptance-key",
    models: [{
      id: "Qwen3.8-27B-WORK",
      name: "Qwen3.8-27B-WORK",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_192,
      maxTokens: 16_384,
    }],
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: "pcr-t13-acceptance", factory }],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    modelRuntime,
    model: modelRuntime.getModel("openclaw", "Qwen3.8-27B-WORK")!,
    settingsManager: settings,
    resourceLoader,
    sessionManager: manager,
    noTools: "all",
  });
  session.agent.streamFunction = (async () => completedStream("ok")) as never;
  return { root, manager, session };
}

describe("real Pi tool_result flow", () => {
  it("persists raw tool bytes in CAS before the host-visible compact projection", async () => {
    const root = dataRoot();
    const manager = SessionManager.inMemory(root);
    const cursor = piCursor(manager);
    const key = Buffer.alloc(32, 13);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("acceptance-t13", key); },
        async get(_workspaceId, keyId) {
          return keyId === "acceptance-t13" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    let blobRef = "";
    const { session } = await createSession((pi) => {
      registerToolResultHook(pi, {
        cursor: (ctx) => piCursor(ctx.sessionManager as SessionManager),
        service(next) {
          return createObservationService({
            cursor: next,
            blobs: {
              async put(scope, bytes) {
                blobRef = await blobs.put(scope, bytes);
                return blobRef as never;
              },
              read: blobs.read.bind(blobs),
            },
            saga,
          });
        },
        clock: { now: () => 1_700_000_000_013 },
        onHardFailure() {},
      });
    }, { root, manager });
    try {
      const hostVisible = await (session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c1",
        toolName: "bash",
        input: { command: "printf secret" },
        content: [{ type: "text", text: SECRET }],
        isError: false,
        details: undefined,
      } as ToolResultEvent);
      const visible = visibleText(hostVisible?.content);
      expect(visible).toContain(SECRET);
      expect(visible).not.toContain("ctx://observation");
      expect(blobRef).toMatch(/^blob_[a-f0-9]{64}$/u);
      const envelope = decodeObservation(await blobs.read(piCursor(manager), blobRef as never));
      expect(envelope.content).toEqual([{ type: "text", text: SECRET }]);
      expect(envelope.toolName).toBe("bash");
    } finally {
      await saga.close();
      await database.close();
    }
  });

  it("is reachable through the only packaged product extension entry", async () => {
    const root = dataRoot();
    const manager = SessionManager.create(root, join(root, "sessions"));
    const { session } = await createSession((pi) => {
      registerProductExtension(pi as never);
    }, { root, manager });
    try {
      const hostVisible = await (session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c-product",
        toolName: "bash",
        input: { command: "printf secret" },
        content: [{ type: "text", text: SECRET }],
        isError: false,
        details: undefined,
      } as ToolResultEvent);
      const visible = visibleText(hostVisible?.content);
      expect(visible).toContain(SECRET);
      expect(visible).not.toContain("ctx://observation");
      expect(root.length).toBeGreaterThan(0);
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("hard-stops the Pi tool_result emitter on integrity failure", async () => {
    const root = dataRoot();
    const manager = SessionManager.inMemory(root);
    const cursor = piCursor(manager);
    const key = Buffer.alloc(32, 13);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("acceptance-t13-fail", key); },
        async get(_workspaceId, keyId) {
          return keyId === "acceptance-t13-fail" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    const failures: string[] = [];
    const { session } = await createSession((pi) => {
      registerToolResultHook(pi, {
        cursor: (ctx) => piCursor(ctx.sessionManager as SessionManager),
        service(next) {
          return createObservationService({
            cursor: next,
            blobs: {
              async put() { throw new Error("cas-io-crash"); },
              read: blobs.read.bind(blobs),
            },
            saga,
          });
        },
        clock: { now: () => 1_700_000_000_013 },
        onHardFailure(error, phase) { failures.push(`${phase}:${String(error)}`); },
      });
    }, { root, manager });
    try {
      await expect((session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<unknown> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c-crash",
        toolName: "bash",
        input: {},
        content: [{ type: "text", text: SECRET }],
        isError: false,
        details: undefined,
      } as ToolResultEvent)).rejects.toThrow("cas-io-crash");
      expect(failures.some((item) => item.includes("cas-io-crash"))).toBe(true);
    } finally {
      await saga.close();
      await database.close();
    }
  });

  it("preserves an image block instead of replacing it with empty text", async () => {
    const root = dataRoot();
    const manager = SessionManager.inMemory(root);
    const cursor = piCursor(manager);
    const key = Buffer.alloc(32, 17);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("acceptance-t03-image", key); },
        async get(_workspaceId, keyId) {
          return keyId === "acceptance-t03-image" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    let blobRef = "";
    const image = { type: "image" as const, mimeType: "image/png", data: "c3ludGhldGlj" };
    const { session } = await createSession((pi) => {
      registerToolResultHook(pi, {
        cursor: (ctx) => piCursor(ctx.sessionManager as SessionManager),
        service(next) {
          return createObservationService({
            cursor: next,
            blobs: {
              async put(scope, bytes) {
                blobRef = await blobs.put(scope, bytes);
                return blobRef as never;
              },
              read: blobs.read.bind(blobs),
            },
            saga,
          });
        },
        clock: { now: () => 1_700_000_000_013 },
        onHardFailure() {},
      });
    }, { root, manager });
    try {
      const hostVisible = await (session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c-image",
        toolName: "read",
        input: {},
        content: [image],
        isError: false,
        details: undefined,
      } as ToolResultEvent);
      expect(visibleText(hostVisible?.content)).toContain("c3ludGhldGlj");
      const envelope = decodeObservation(await blobs.read(piCursor(manager), blobRef as never));
      expect(envelope.content).toEqual([image]);
    } finally {
      await saga.close();
      await database.close();
    }
  });

  it("does not ingest retrieval tool results a second time", async () => {
    const root = dataRoot();
    const manager = SessionManager.inMemory(root);
    let ingested = 0;
    const { session } = await createSession((pi) => {
      registerToolResultHook(pi, {
        cursor: (ctx) => piCursor(ctx.sessionManager as SessionManager),
        service() {
          return {
            async ingest() {
              ingested += 1;
              throw new Error("retrieval must not be ingested");
            },
            async acknowledge() {},
          };
        },
        clock: { now: () => 1_700_000_000_013 },
        onHardFailure() {},
      });
    }, { root, manager });
    const page = [{ type: "text" as const, text: "evidence page" }];
    const hostVisible = await (session as unknown as {
      _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
    })._extensionRunner.emitToolResult({
      type: "tool_result",
      toolCallId: "c-read",
      toolName: "context_read",
      input: { evidenceId: "ev_deadbeef" },
      content: page,
      isError: false,
      details: undefined,
    } as ToolResultEvent);
    expect(ingested).toBe(0);
    expect(hostVisible?.content).toEqual(page);
  });

  it("puts a failed tool name and exit into the next provider request", async () => {
    const harness = await createProductHarness();
    try {
      harness.scriptToolResult("bash", {
        content: [{
          type: "text",
          text: `${Array.from({ length: 80 }, (_, index) => `noise ${index}`).join("\n")}\nerror: FAILED UserServiceTest\nexit code 1`,
        }],
        isError: true,
        details: { exitCode: 1 },
      });
      await harness.runToolTurn("bash", { command: "npm test" });
      await harness.prompt("What failed in the previous tool result?");
      const seen = JSON.stringify(harness.requests());
      expect(seen).toContain("UserServiceTest");
      expect(seen).toContain("exit");
    } finally {
      await harness.close();
    }
  });
});
