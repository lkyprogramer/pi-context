import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { register as registerProductExtension } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { enableExperimentalProductRuntime } from "../helpers/product-harness.js";

const roots: string[] = [];
const PAYLOAD = "cache invalidation strategy\nerror: boom\nexit code 1";

let restoreRuntimeMode: (() => void) | undefined;
beforeEach(() => {
  restoreRuntimeMode = enableExperimentalProductRuntime();
});
afterEach(() => {
  restoreRuntimeMode?.();
  restoreRuntimeMode = undefined;
  resetOwnerForTest();
  vi.restoreAllMocks();
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
      // Pi emits tool_result for extension tools too. Retrieval must reach the model
      // as the verified page, not become a new pointer to a pointer.
      for (const toolName of ["context_read", "context_recall", "context_search"]) {
        const emitted = await (session as unknown as {
          _extensionRunner: { emitToolResult(event: ToolResultEvent): Promise<{ content?: unknown }> };
        })._extensionRunner.emitToolResult({
          type: "tool_result", toolCallId: `self-${toolName}`, toolName,
          input: { evidenceId: searchBody.hits[0]!.evidenceId },
          content: readOut.content, isError: false, details: {},
        } as ToolResultEvent);
        expect(emitted.content).toEqual(readOut.content);
      }

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
            messagesToSummarize: [{ role: "user", content: "do not deploy production", timestamp: 1000 }],
          },
        },
        host,
      );
      expect(result).toEqual({ cancel: true });
    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("does not backfill authenticated directives without a source timestamp", async () => {
    const { session, manager, cursor, beforeCompact, root } = await createProductSession();
    try {
      const result = await beforeCompact!({ reason: "threshold", preparation: {
        tokensBefore: 8000, firstKeptEntryId: "entry-keep", allow: true,
        messagesToSummarize: [{ role: "user", content: "Never deploy production" }],
      } }, { abort() {}, cwd: manager.getCwd(), sessionManager: manager,
        model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
        workspaceId: cursor.workspaceId, sessionId: manager.getSessionId(),
      });
      expect(result).toBeUndefined();
      const database = new DatabaseSync(join(root, "sessions", ".context-runtime", cursor.workspaceId, "runtime.sqlite"), { readOnly: true });
      try { expect(database.prepare("SELECT receipt_id FROM user_turn_ledger").all()).toHaveLength(0); }
      finally { database.close(); }
    } finally {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
  });

  it("preserves ingress timestamps and repeated inputs when compaction re-enters", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { session, manager, cursor, beforeCompact, root } = await createProductSession();
    const preparation = {
      tokensBefore: 8000, firstKeptEntryId: "entry-keep", allow: true,
      messagesToSummarize: [
        { role: "user", content: "historical build observation", timestamp: 1000 },
        { role: "user", content: "historical build observation", timestamp: 2000 },
      ],
    };
    const context = {
      abort() {}, cwd: manager.getCwd(), sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
      workspaceId: cursor.workspaceId, sessionId: manager.getSessionId(),
    };
    try {
      clock.mockReturnValue(1000);
      await session.prompt("historical build observation");
      clock.mockReturnValue(2000);
      await session.prompt("historical build observation");
      clock.mockReturnValue(3000);
      await beforeCompact!({ reason: "threshold", preparation }, context);
      await beforeCompact!({ reason: "threshold", preparation: {
        ...preparation, messagesToSummarize: [{ role: "assistant", content: "unrelated", timestamp: 500 }, ...preparation.messagesToSummarize],
      } }, context);
      const database = new DatabaseSync(join(root, "sessions", ".context-runtime", cursor.workspaceId, "runtime.sqlite"), { readOnly: true });
      try {
        const rows = database.prepare("SELECT captured_at FROM user_turn_ledger WHERE operation_id LIKE 'input_%' ORDER BY captured_at").all();
        expect(rows.map(row => row.captured_at)).toEqual([1000, 2000]);
      } finally { database.close(); }
    } finally {
      clock.mockRestore();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
  });

  it("runs the product session_before_compact hook against a live Pi session context", async () => {
    const { session, manager, cursor, beforeCompact } = await createProductSession();
    try {
      expect(beforeCompact).toEqual(expect.any(Function));
      await session.prompt("do not deploy production; 改为 version 7");
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7", timestamp: 1000 }],
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
      await session.prompt("do not deploy production; 改为 version 7");
      const result = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7", timestamp: 1000 }],
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
      const repeat = await beforeCompact!(
        {
          reason: "threshold",
          preparation: {
            tokensBefore: 8000,
            firstKeptEntryId: "entry-keep",
            allow: true,
            messagesToSummarize: [{ role: "user", content: "do not deploy production; 改为 version 7", timestamp: 1000 }],
          },
        },
        {
          abort() {}, cwd: manager.getCwd(), sessionManager: manager,
          model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
          workspaceId: cursor.workspaceId, sessionId: manager.getSessionId(),
        },
      );
      const repeatLine = (repeat as { compaction?: { details?: { reducerRevisions?: string[] } } } | undefined)?.compaction?.details?.reducerRevisions?.find((item) => item.startsWith("snapshot:"));
      expect(repeatLine).toBe(snapshotLine);
      const database = new DatabaseSync(join(manager.getSessionDir(), ".context-runtime", cursor.workspaceId, "runtime.sqlite"), { readOnly: true });
      try {
        const rows = database.prepare("SELECT source_class, operation_id FROM user_turn_ledger").all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ source_class: "authenticated-user", operation_id: expect.stringMatching(/^input_/u) });
      } finally { database.close(); }

    } finally {
      await (session as unknown as { dispose?: () => void }).dispose?.();
    }
  });

  it("restores ancestor constraints even when the current leaf has a newer directive", async () => {
    const { session, manager, cursor, beforeCompact } = await createProductSession();
    const compact = () => beforeCompact!({ reason: "threshold", preparation: {
      tokensBefore: 8000, firstKeptEntryId: "entry-keep", allow: true,
      messagesToSummarize: [{ role: "user", content: "do not deploy production", timestamp: 1000 }],
    } }, { abort() {}, cwd: manager.getCwd(), sessionManager: manager,
      model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 } });
    try {
      await session.prompt("do not deploy production");
      expect(await compact()).toHaveProperty("compaction");
      await session.prompt("continue with the task"); // Advance to another leaf after the first projection.
      const input = await (session as unknown as { _extensionRunner: {
        emitInput(text: string, images: undefined, source: "interactive", behavior: undefined, id: string): Promise<{ action: string }>;
      } })._extensionRunner.emitInput("must use version 8", undefined, "interactive", undefined, "pi_input_00000000-0000-4000-8000-000000000088");
      expect(input.action).toBe("continue");
      const result = await compact() as { compaction?: { summary: string } };
      expect(result.compaction?.summary).toContain("do not deploy production");
      expect(result.compaction?.summary).toContain("version 8");
      const database = new DatabaseSync(join(manager.getSessionDir(), ".context-runtime", cursor.workspaceId, "runtime.sqlite"), { readOnly: true });
      try {
        expect(database.prepare("SELECT count(*) AS count FROM user_turn_ledger").get()).toMatchObject({ count: 3 });
      } finally { database.close(); }
    } finally { await (session as unknown as { dispose?: () => void }).dispose?.(); }
  });

  it("publishes no partial projection when a later receipt fails and retries the complete branch", async () => {
    const { session, manager, cursor, beforeCompact } = await createProductSession();
    try {
      await session.prompt("do not deploy production");
      await session.prompt("must use version 9");
      const database = new DatabaseSync(join(manager.getSessionDir(), ".context-runtime", cursor.workspaceId, "runtime.sqlite"));
      try {
        const rows = database.prepare("SELECT receipt_id, raw_text_hash FROM user_turn_ledger ORDER BY captured_at, rowid").all() as Array<{ receipt_id: string; raw_text_hash: string }>;
        expect(rows).toHaveLength(2);
        const later = rows[1]!;
        database.prepare("UPDATE user_turn_ledger SET raw_text_hash = ? WHERE receipt_id = ?").run("f".repeat(64), later.receipt_id);
        const compact = () => beforeCompact!({ reason: "threshold", preparation: {
          tokensBefore: 8000, firstKeptEntryId: "entry-keep", allow: true,
          messagesToSummarize: [{ role: "user", content: "do not deploy production; must use version 9" }],
        } }, { abort() {}, cwd: manager.getCwd(), sessionManager: manager,
          model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 } });
        expect(await compact()).toBeUndefined();
        expect(database.prepare("SELECT count(*) AS count FROM directive_record WHERE leaf_id = ?").get(manager.getLeafId())).toMatchObject({ count: 0 });
        database.prepare("UPDATE user_turn_ledger SET raw_text_hash = ? WHERE receipt_id = ?").run(later.raw_text_hash, later.receipt_id);
        const result = await compact() as { compaction?: { summary: string } };
        expect(result.compaction?.summary).toContain("do not deploy production");
        expect(result.compaction?.summary).toContain("version 9");
        expect(database.prepare("SELECT count(*) AS count FROM user_turn_ledger").get()).toMatchObject({ count: 2 });
      } finally { database.close(); }
    } finally { await (session as unknown as { dispose?: () => void }).dispose?.(); }
  });

  it.each(["legacy", "extension"] as const)("does not promote %s input without an authenticated receipt", async (source) => {
    const { session, manager, beforeCompact } = await createProductSession();
    try {
      if (source === "extension") await session.prompt("do not deploy production", { source: "extension" });
      else manager.appendMessage({ role: "user", content: "do not deploy production" } as never);
      const result = await beforeCompact!({
        reason: "threshold", preparation: {
          tokensBefore: 8000, firstKeptEntryId: "entry-keep", allow: true,
          messagesToSummarize: [{ role: "user", content: "do not deploy production", timestamp: 1000 }],
        },
      }, {
        abort() {}, cwd: manager.getCwd(), sessionManager: manager,
        model: { provider: "openclaw", id: "Qwen3.8-27B-WORK", contextWindow: 200192, maxTokens: 16384 },
      });
      expect(result).toBeUndefined(); // Native compaction retains control when provenance is missing.
    } finally { await (session as unknown as { dispose?: () => void }).dispose?.(); }
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
