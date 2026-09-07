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

import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { RuntimeSessionApplicationService } from "@pcr/runtime";
import {
  createProductionCompositionRoot,
  type PiRuntimeContext,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";
import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];
const PAYLOAD = "cache invalidation strategy\nerror: boom\nexit code 1";

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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

async function createProductSession() {
  const root = mkdtempSync(join(tmpdir(), "pcr-session-own-"));
  roots.push(root);
  const manager = SessionManager.create(root, join(root, "sessions"));
  let beforeCompact: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  const factory: ExtensionFactory = (pi) => {
    const on = pi.on.bind(pi);
    pi.on = ((hook: string, handler: (...args: never[]) => unknown) => {
      if (hook === "session_before_compact") beforeCompact = handler as typeof beforeCompact;
      return on(hook as never, handler as never);
    }) as typeof pi.on;
    registerProductExtension(pi as never);
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
    apiKey: "offline-session-own-key",
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
    extensionFactories: [{ name: "pcr-session-own", factory }],
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
  const branch = manager.getBranch().map((entry) => entry.id);
  const cursor = createRuntimeCursor({
    workspacePath: manager.getCwd(),
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId(),
    lineageEntryIds: branch.length > 0 ? branch : [manager.getHeader()!.id],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  return { session, manager, cursor, beforeCompact };
}

describe("runtime session ingress ownership", () => {
  it("sends product tool_result through RuntimeSession.ingestToolResult", async () => {
    const original = RuntimeSessionApplicationService.prototype.ingestToolResult;
    const calls: string[] = [];
    RuntimeSessionApplicationService.prototype.ingestToolResult = async function ingestThroughSession(input) {
      calls.push(input.operationId);
      return original.call(this, input);
    };
    try {
      const { session } = await createProductSession();
      try {
        await (session as unknown as {
          _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<unknown> };
        })._extensionRunner.emitToolResult({
          type: "tool_result",
          toolCallId: "c-own-1",
          toolName: "bash",
          input: { command: "npm test" },
          content: [{ type: "text", text: PAYLOAD }],
          isError: true,
          details: { exitCode: 1 },
        } as ToolResultEvent);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatch(/^obsop_/u);
      } finally {
        await (session as unknown as { dispose?: () => void }).dispose?.();
      }
    } finally {
      RuntimeSessionApplicationService.prototype.ingestToolResult = original;
    }
  });

  it("sends product user input through RuntimeSession.ingestUserInput", async () => {
    const original = RuntimeSessionApplicationService.prototype.ingestUserInput;
    const calls: string[] = [];
    RuntimeSessionApplicationService.prototype.ingestUserInput = async function ingestThroughSession(input) {
      calls.push(input.operationId);
      return original.call(this, input);
    };
    try {
      const { session } = await createProductSession();
      try {
        await session.prompt("do not deploy production; keep version 7");
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0]).toMatch(/^input_/u);
      } finally {
        await (session as unknown as { dispose?: () => void }).dispose?.();
      }
    } finally {
      RuntimeSessionApplicationService.prototype.ingestUserInput = original;
    }
  });
});

describe("runtime session write chain", () => {
  it("runs compaction prepare only after a held ingest finishes", async () => {
    const order: string[] = [];
    let releaseIngest!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseIngest = resolve;
    });
    const resources: ProductionSessionResourcesFactory = {
      async create(ctx) {
        return {
          ports: {
            userInput: {
              async capture(input) {
                order.push("ingest-start");
                await hold;
                order.push("ingest-end");
                return {
                  operationId: input.operationId,
                  receiptId: `receipt-${ctx.sessionId}`,
                  status: "pending" as const,
                  cursor: input.cursor,
                  rawTextHash: "a".repeat(64),
                  rawBlobId: blobId(`blob_${domainHash("own-chain", ctx.sessionId)}`),
                  utf8Bytes: 1,
                  sourceClass: input.sourceClass,
                  capturedAt: input.capturedAt,
                };
              },
            },
            toolResult: {
              async ingest(input) {
                return {
                  operationId: input.operationId,
                  observationId: `obs-${ctx.sessionId}`,
                  rawBlobId: blobId(`blob_${domainHash("own-chain", ctx.sessionId)}`),
                  evidenceIds: [],
                  visibleContent: input.content,
                  isError: input.isError,
                  reducer: { id: "own-chain", revision: "1" },
                };
              },
            },
            materialization: {
              async materialize() {
                return { messages: [], tokenCost: 0, cache: { eligiblePrefixTokens: 0 } } as never;
              },
            },
            compaction: {
              async prepare() {
                order.push("compact-prepare");
                return { kind: "native-fallback" as const };
              },
            },
          },
          async dispose() {},
        };
      },
    };
    const root = createProductionCompositionRoot({
      identity: { create: createRuntimeCursor },
      resources,
    });
    const manager = SessionManager.inMemory("/tmp/pcr-own-chain");
    const ctx: PiRuntimeContext = {
      cwd: manager.getCwd(),
      sessionManager: manager,
      model: {
        provider: "openclaw",
        id: "Qwen3.8-27B-WORK",
        contextWindow: 200_192,
        maxTokens: 16_384,
      } as PiRuntimeContext["model"],
    };
    const session = await root.open(ctx);
    const ingest = session.ingestUserInput({
      operationId: "op-ingest",
      cursor: session.scope as never,
      rawText: "hold",
      sourceClass: "authenticated-user",
      capturedAt: 1,
    });
    await Promise.resolve();
    expect(order).toEqual(["ingest-start"]);
    const compact = session.prepareCompaction!({
      operationId: "op-compact",
      cursor: session.scope as never,
      reason: "threshold",
      now: 1,
      tokensBefore: 8000,
      firstKeptEntryId: "keep-1",
    });
    await Promise.resolve();
    expect(order).toEqual(["ingest-start"]);
    releaseIngest();
    await Promise.all([ingest, compact]);
    expect(order).toEqual(["ingest-start", "ingest-end", "compact-prepare"]);
  });
});
