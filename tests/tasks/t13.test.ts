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

import { createRuntimeCursor } from "@pcr/core";
import { registerToolResultHook } from "@pcr/pi-adapter";
import {
  createObservationService,
  type ObservationService,
  type ProjectedToolResult,
} from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const roots: string[] = [];
const SECRET = "secret output";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-t13-red-"));
  roots.push(value);
  return value;
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

interface ToolResultSession {
  _extensionRunner: {
    emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown } | undefined>;
  };
}

async function openHarness(options: {
  wrapBlobs?(blobs: ReturnType<typeof createEncryptedBlobStore>): ReturnType<typeof createEncryptedBlobStore>;
} = {}) {
  const root = dataRoot();
  const manager = SessionManager.inMemory(root);
  const branch = manager.getBranch().map((entry) => entry.id);
  const cursor = createRuntimeCursor({
    workspacePath: manager.getCwd(),
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId(),
    lineageEntryIds: branch.length > 0 ? branch : [manager.getHeader()!.id],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 13);
  const rawBlobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: cursor.workspaceId,
    maxBlobBytes: 4096,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t13", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t13" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const blobs = options.wrapBlobs?.(rawBlobs) ?? rawBlobs;
  const database = await openWorkspaceSqliteStore({
    dataRoot: root,
    workspaceId: cursor.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const saga = await openWorkspaceSagaJournal({
    database,
    async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
  });
  const services = new Map<string, ObservationService>();
  const failures: string[] = [];
  let capturedAt = 1_700_000_000_013;
  const pcr: ExtensionFactory = (pi) => {
    registerToolResultHook(pi, {
      cursor: () => cursor,
      service(next) {
        const mapKey = JSON.stringify(next);
        let service = services.get(mapKey);
        if (!service) {
          service = createObservationService({ cursor: next, blobs, saga });
          services.set(mapKey, service);
        }
        return service;
      },
      clock: { now: () => capturedAt++ },
      onHardFailure(error, phase) { failures.push(`${phase}:${String(error)}`); },
    });
  };
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
    apiKey: "offline-t13-key",
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
    extensionFactories: [{ name: "pcr-t13", factory: pcr }],
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
  const blobStore = {
    async read(ref: ProjectedToolResult["rawBlobId"]) {
      return Buffer.from(await blobs.read(cursor, ref));
    },
  };
  return {
    cursor,
    blobs,
    blobStore,
    saga,
    session: session as unknown as ToolResultSession,
    failures,
    async close() {
      await saga.close();
      await database.close();
    },
  };
}

async function invokeRealPiToolResultEvent(input: {
  toolCallId: string;
  toolName: string;
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  details?: unknown;
  usage?: ToolResultEvent["usage"];
}, harness?: Awaited<ReturnType<typeof openHarness>>) {
  const owned = harness ?? await openHarness();
  const event = {
    type: "tool_result" as const,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: { command: "printf secret" },
    content: input.content,
    isError: input.isError,
    details: input.details,
    ...(input.usage === undefined ? {} : { usage: input.usage }),
  } as ToolResultEvent;
  const hostVisible = await owned.session._extensionRunner.emitToolResult(event);
  const visibleText = JSON.stringify(hostVisible?.content ?? "");
  const blobMatch = visibleText.match(/blob_[a-f0-9]{64}/u);
  return {
    harness: owned,
    result: {
      receipt: { blobRef: blobMatch?.[0] as ProjectedToolResult["rawBlobId"] | undefined },
      visible: { content: visibleText },
      hostVisible,
    },
  };
}

describe("T13 Real Pi tool_result ingress", () => {
  it("writes raw bytes before returning the compact tool result", async () => {
    const invoked = await invokeRealPiToolResultEvent({
      toolCallId: "c1",
      toolName: "bash",
      content: [{ type: "text", text: SECRET }],
      isError: false,
    });
    const { harness, result } = invoked;
    try {
      expect(await harness.blobStore.read(result.receipt.blobRef!)).toEqual(Buffer.from(SECRET));
      expect(result.visible.content).not.toContain(SECRET);
    } finally {
      await harness.close();
    }
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createObservationService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_OBSERVATION_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed input before I/O", async () => {
    const harness = await openHarness();
    let puts = 0;
    const wrapped = {
      put: async (...args: Parameters<typeof harness.blobs.put>) => {
        puts += 1;
        return harness.blobs.put(...args);
      },
      read: harness.blobs.read.bind(harness.blobs),
    };
    const service = createObservationService({
      cursor: harness.cursor,
      blobs: wrapped,
      saga: harness.saga,
    });
    try {
      await expect(service.ingest({
        operationId: "",
        cursor: harness.cursor,
        toolCallId: "c-bad",
        toolName: "bash",
        args: {},
        content: [{ type: "text", text: SECRET }],
        details: null,
        isError: false,
        capturedAt: 1,
        sourceClass: "untrusted-tool",
        authority: "inform",
      })).rejects.toThrow(/PCR_OBSERVATION_INPUT_INVALID/);
      expect(puts).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("is idempotent for duplicate tool_result ingest", async () => {
    const harness = await openHarness();
    const service = createObservationService({
      cursor: harness.cursor,
      blobs: harness.blobs,
      saga: harness.saga,
    });
    const input = {
      operationId: "op-t13-dup",
      cursor: harness.cursor,
      toolCallId: "c-dup",
      toolName: "bash",
      args: { command: "printf secret" },
      content: [{ type: "text" as const, text: SECRET }],
      details: { exitCode: 0 },
      isError: false,
      capturedAt: 13,
      sourceClass: "untrusted-tool" as const,
      authority: "inform" as const,
    };
    try {
      const first = await service.ingest(input);
      const second = await service.ingest(input);
      expect(second).toEqual(first);
      expect(await harness.blobStore.read(first.rawBlobId)).toEqual(Buffer.from(SECRET));
    } finally {
      await harness.close();
    }
  });

  it("rejects a tool_result from the wrong workspace/session/branch", async () => {
    const harness = await openHarness();
    const service = createObservationService({
      cursor: harness.cursor,
      blobs: harness.blobs,
      saga: harness.saga,
    });
    try {
      await expect(service.ingest({
        operationId: "op-t13-scope",
        cursor: { ...harness.cursor, sessionId: "other-session" },
        toolCallId: "c-scope",
        toolName: "bash",
        args: {},
        content: [{ type: "text", text: SECRET }],
        details: null,
        isError: false,
        capturedAt: 13,
        sourceClass: "untrusted-tool",
        authority: "inform",
      })).rejects.toThrow(/PCR_OBSERVATION_SCOPE_MISMATCH/);
    } finally {
      await harness.close();
    }
  });

  it("propagates blob I/O failure as a hard-stop through the real Pi runner", async () => {
    const harness = await openHarness({
      wrapBlobs(blobs) {
        return {
          async put() { throw new Error("cas-io-crash"); },
          read: blobs.read.bind(blobs),
        };
      },
    });
    try {
      await expect(invokeRealPiToolResultEvent({
        toolCallId: "c-crash",
        toolName: "bash",
        content: [{ type: "text", text: SECRET }],
        isError: false,
      }, harness)).rejects.toThrow("cas-io-crash");
      expect(harness.failures.some((item) => item.includes("cas-io-crash"))).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("stops at the abort boundary before writing a blob", async () => {
    const harness = await openHarness();
    let puts = 0;
    const service = createObservationService({
      cursor: harness.cursor,
      blobs: {
        async put(...args) {
          puts += 1;
          return harness.blobs.put(...args);
        },
        read: harness.blobs.read.bind(harness.blobs),
      },
      saga: harness.saga,
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(service.ingest({
        operationId: "op-t13-abort",
        cursor: harness.cursor,
        toolCallId: "c-abort",
        toolName: "bash",
        args: {},
        content: [{ type: "text", text: SECRET }],
        details: null,
        isError: false,
        capturedAt: 13,
        sourceClass: "untrusted-tool",
        authority: "inform",
        signal: controller.signal,
      })).rejects.toThrow();
      expect(puts).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it("replays equal results across two independent runs of the same event", async () => {
    const first = await invokeRealPiToolResultEvent({
      toolCallId: "c-eq",
      toolName: "bash",
      content: [{ type: "text", text: SECRET }],
      isError: false,
    });
    const second = await invokeRealPiToolResultEvent({
      toolCallId: "c-eq",
      toolName: "bash",
      content: [{ type: "text", text: SECRET }],
      isError: false,
    });
    try {
      expect(first.result.visible.content).not.toContain(SECRET);
      expect(second.result.visible.content).not.toContain(SECRET);
      expect(first.result.visible.content).toMatch(/\[pcr observation pointer\] ctx:\/\/observation\/blob_[a-f0-9]{64}/u);
      expect(second.result.visible.content).toMatch(/\[pcr observation pointer\] ctx:\/\/observation\/blob_[a-f0-9]{64}/u);
      expect(await first.harness.blobStore.read(first.result.receipt.blobRef!)).toEqual(Buffer.from(SECRET));
      expect(await second.harness.blobStore.read(second.result.receipt.blobRef!)).toEqual(Buffer.from(SECRET));
    } finally {
      await first.harness.close();
      await second.harness.close();
    }
  });
});
