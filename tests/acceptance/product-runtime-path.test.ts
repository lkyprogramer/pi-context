import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
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
import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";

const roots: string[] = [];
const PAYLOAD = "cache invalidation strategy\nerror: boom\nexit code 1";

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-product-runtime-"));
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

type RuntimeTool = {
  name: string;
  execute(
    callId: string,
    args: Record<string, unknown>,
    a?: unknown,
    b?: unknown,
    ctx?: { workspaceId?: string; sessionId?: string },
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

async function createProductSession() {
  const root = dataRoot();
  const manager = SessionManager.create(root, join(root, "sessions"));
  const tools = new Map<string, RuntimeTool>();
  let beforeCompact: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  const factory: ExtensionFactory = (pi) => {
    const on = pi.on.bind(pi);
    pi.on = ((hook: string, handler: (...args: never[]) => unknown) => {
      if (hook === "session_before_compact") beforeCompact = handler as typeof beforeCompact;
      return on(hook as never, handler as never);
    }) as typeof pi.on;
    const registerTool = pi.registerTool.bind(pi);
    pi.registerTool = ((tool: RuntimeTool) => {
      tools.set(tool.name, tool);
      return registerTool(tool as never);
    }) as typeof pi.registerTool;
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
    apiKey: "offline-product-runtime-key",
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
    extensionFactories: [{ name: "pcr-product-runtime", factory }],
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
  return { root, manager, session, tools, cursor, beforeCompact };
}

describe("product runtime SQLite/FTS/CAS path", () => {
  it("does not return owner.service or owner.observation from production hook resolvers", () => {
    const source = readFileSync("apps/pi-context-runtime/src/composition-root.ts", "utf8");
    expect(source).not.toMatch(/return owner\.service\(cursor\)/);
    expect(source).not.toMatch(/return owner\.observation\(cursor\)/);
    expect(source).toMatch(/ingestUserInput:\s*\(input\)\s*=>\s*session\.ingestUserInput\(input\)/);
    expect(source).toMatch(/ingestToolResult:\s*\(input\)\s*=>\s*session\.ingestToolResult\(input\)/);
  });

  it("admits tool_result into the same store that context_search and context_read use", async () => {
    const { session, tools, cursor, manager } = await createProductSession();
    try {
      expect(tools.has("context_search")).toBe(true);
      expect(tools.has("context_read")).toBe(true);
      const hostVisible = await (session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c-product-fts",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: PAYLOAD }],
        isError: true,
        details: { exitCode: 1 },
      } as ToolResultEvent);
      const visible = JSON.stringify(hostVisible?.content ?? "");
      expect(visible).not.toContain("boom");
      expect(visible).toMatch(/blob_[a-f0-9]{64}/u);

      const searchOut = await tools.get("context_search")!.execute(
        "t-search",
        { query: "invalidation" },
        undefined,
        undefined,
        { workspaceId: cursor.workspaceId, sessionId: manager.getSessionId() },
      );
      const searchBody = JSON.parse(searchOut.content[0]?.text ?? "{}") as { hits: Array<{ evidenceId: string }> };
      expect(searchBody.hits[0]?.evidenceId).toMatch(/^ev_/u);

      const readOut = await tools.get("context_read")!.execute(
        "t-read",
        { evidenceId: searchBody.hits[0]!.evidenceId },
        undefined,
        undefined,
        { workspaceId: cursor.workspaceId, sessionId: manager.getSessionId() },
      );
      const readBody = JSON.parse(readOut.content[0]?.text ?? "{}") as { verified: boolean; text: string; sha256: string };
      expect(readBody.verified).toBe(true);
      expect(readBody.text).toContain("cache invalidation strategy");
      expect(readBody.sha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  function deleteBlobObjects(root: string): number {
    const stack = [root];
    let removed = 0;
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          stack.push(path);
          continue;
        }
        if (name.endsWith(".bin")) {
          unlinkSync(path);
          removed += 1;
        }
      }
    }
    return removed;
  }

  it("hard-stops compact when a CAS pointer is missing on the extension entry", async () => {
    const { session, manager, cursor, beforeCompact, root } = await createProductSession();
    try {
      await (session as unknown as {
        _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
      })._extensionRunner.emitToolResult({
        type: "tool_result",
        toolCallId: "c-pointer-missing",
        toolName: "bash",
        input: { command: "npm test" },
        content: [{ type: "text", text: PAYLOAD }],
        isError: true,
        details: { exitCode: 1 },
      } as ToolResultEvent);
      expect(deleteBlobObjects(root)).toBeGreaterThan(0);
      const host = {
        abort() {},
        cwd: manager.getCwd(),
        sessionManager: manager,
        model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
        workspaceId: cursor.workspaceId,
        sessionId: manager.getSessionId(),
      };
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production" }],
          },
        },
        host,
      );
      expect(result).toEqual({ cancel: true });
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("runs the product session_before_compact hook against a live Pi session context", async () => {
    const { session, manager, cursor, beforeCompact } = await createProductSession();
    try {
      expect(beforeCompact).toEqual(expect.any(Function));
      manager.appendMessage({ role: "user", content: "do not deploy production; 改为 version 7" } as never);
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7" }],
          },
        },
        {
          abort() {},
          cwd: manager.getCwd(),
          sessionManager: manager,
          model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
          workspaceId: cursor.workspaceId,
          sessionId: manager.getSessionId(),
        },
      );
      const compaction = (result as { compaction?: { summary: string; details: { directiveHead: string } } } | undefined)?.compaction;
      expect(compaction).toBeDefined();
      expect(compaction?.details.directiveHead).not.toBe("dh_runtime");
      expect(compaction?.summary.includes("must-not/active")).toBe(false);
      expect(compaction?.summary.includes("do not deploy production")).toBe(true);
      expect(compaction?.summary.includes("改为 version 7")).toBe(true);
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("uses the same runtime snapshot hash for materialize rows and product compaction", async () => {
    const { session, manager, cursor, beforeCompact, root } = await createProductSession();
    try {
      manager.appendMessage({ role: "user", content: "do not deploy production; 改为 version 7" } as never);
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7" }],
          },
        },
        {
          abort() {},
          cwd: manager.getCwd(),
          sessionManager: manager,
          model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
          workspaceId: cursor.workspaceId,
          sessionId: manager.getSessionId(),
        },
      );
      const details = (result as { compaction?: { details?: { reducerRevisions?: string[] } } } | undefined)?.compaction?.details;
      const snapshotLine = details?.reducerRevisions?.find((item) => item.startsWith("snapshot:"));
      expect(snapshotLine).toMatch(/^snapshot:[a-f0-9]{64}$/u);
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("hard-stops product compact on an unpaired tool result", async () => {
    const { session, manager, cursor, beforeCompact } = await createProductSession();
    try {
      let aborted = 0;
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "toolResult", toolCallId: "orphan-call", id: "r-orphan" }],
          },
        },
        {
          abort() { aborted += 1; },
          cwd: manager.getCwd(),
          sessionManager: manager,
          model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
          workspaceId: cursor.workspaceId,
          sessionId: manager.getSessionId(),
        },
      );
      expect(aborted).toBe(1);
      expect(result).toEqual({ cancel: true });
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });
});
