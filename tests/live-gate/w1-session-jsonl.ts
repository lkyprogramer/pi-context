import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { W2Case } from "../w2-gate/corpus.js";

export const LIVE_MODEL = "openclaw/Qwen3.8-27B-WORK";
export const LIVE_PROVIDER = "openclaw";
export const LIVE_RESERVE_TOKENS = 16384;
export const LIVE_KEEP_RECENT_TOKENS = 2048;
export const PREFIX_PAD_CHARS = 24_000;

export function padDump(raw: string, minChars = PREFIX_PAD_CHARS): string {
  if (raw.length >= minChars) return raw;
  const line = "hist-fill keep-out-of-tail xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n";
  const n = Math.ceil((minChars - raw.length) / line.length);
  return `${raw}\n${line.repeat(n)}`;
}

function entryId(used: Set<string>, seed?: number, salt = "id"): string {
  for (let i = 0; i < 32; i += 1) {
    const id = seed === undefined
      ? randomUUID().replaceAll("-", "").slice(0, 8)
      : createHash("sha256").update(`w2-entry:${seed}:${salt}:${used.size}:${i}`, "utf8").digest("hex").slice(0, 8);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  throw new Error("failed to allocate session entry id");
}

const emptyUsage = {
  input: 128,
  output: 32,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 160,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface FrozenSession {
  sessionId: string;
  sessionFile: string;
  firstUserId: string;
  assistantId: string;
  toolResultId: string;
  retainedTailId: string;
  expectedFirstKeptId: string;
}

export function writeW1ShapedSession(opts: {
  sessionFile: string;
  cwd: string;
  item: W2Case;
  now?: number;
  seed?: number;
}): FrozenSession {
  const used = new Set<string>();
  const sessionId = opts.seed === undefined
    ? randomUUID()
    : createHash("sha256").update(`w2-session:${opts.item.id}:${opts.seed}`, "utf8").digest("hex").slice(0, 32);
  const ts = opts.now ?? Date.now();
  const iso = new Date(ts).toISOString();
  const modelId = entryId(used, opts.seed, "model");
  const firstUserId = entryId(used, opts.seed, "user");
  const assistantId = entryId(used, opts.seed, "assistant");
  const toolResultId = entryId(used, opts.seed, "tool");
  const retainedTailId = entryId(used, opts.seed, "tail");
  const toolCallId = opts.seed === undefined ? `call_${opts.item.id}` : `call_${opts.item.id}_${opts.seed}`;
  const dump = padDump(opts.item.raw);

  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: iso,
    cwd: opts.cwd,
  };
  const modelChange = {
    type: "model_change",
    id: modelId,
    parentId: null,
    timestamp: iso,
    provider: LIVE_PROVIDER,
    modelId: LIVE_MODEL,
  };
  const firstUser = {
    type: "message",
    id: firstUserId,
    parentId: modelId,
    timestamp: iso,
    message: {
      role: "user",
      content: [{ type: "text", text: opts.item.userText }],
      timestamp: ts,
    },
  };
  const assistant = {
    type: "message",
    id: assistantId,
    parentId: firstUserId,
    timestamp: iso,
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: toolCallId,
          name: opts.item.toolName,
          arguments: { path: opts.item.path },
        },
      ],
      api: "openai-completions",
      provider: LIVE_PROVIDER,
      model: LIVE_MODEL,
      usage: emptyUsage,
      stopReason: "toolUse",
      timestamp: ts + 1,
    },
  };
  const toolResult = {
    type: "message",
    id: toolResultId,
    parentId: assistantId,
    timestamp: iso,
    message: {
      role: "toolResult",
      toolCallId,
      toolName: opts.item.toolName,
      content: [{ type: "text", text: dump }],
      isError: false,
      timestamp: ts + 2,
    },
  };
  const retainedTail = {
    type: "message",
    id: retainedTailId,
    parentId: toolResultId,
    timestamp: iso,
    message: {
      role: "user",
      content: [{ type: "text", text: opts.item.retainedTail }],
      timestamp: ts + 3,
    },
  };

  mkdirSync(dirname(opts.sessionFile), { recursive: true });
  writeFileSync(
    opts.sessionFile,
    [header, modelChange, firstUser, assistant, toolResult, retainedTail].map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  return {
    sessionId,
    sessionFile: opts.sessionFile,
    firstUserId,
    assistantId,
    toolResultId,
    retainedTailId,
    expectedFirstKeptId: retainedTailId,
  };
}

export function closedLoopProbe(item: W2Case): string {
  switch (item.family) {
    case "tool-heavy":
      return item.cjk
        ? "可以改 public API 来修测试吗？只回答是或否，然后一句理由。"
        : "May we change the public API to fix the test? Answer yes or no, then one sentence.";
    case "temporal-update":
      return item.cjk
        ? "当前生效版本号是什么？只回复版本字符串。"
        : "What version is currently active? Reply with the version string only.";
    case "branch":
      return item.cjk
        ? "现在可以合并 sibling-branch 吗？只回答是或否，然后一句理由。"
        : "Should we merge sibling-branch now? Answer yes or no, then one sentence.";
    case "constraint":
    case "overflow":
    default:
      return item.cjk
        ? "现在可以部署生产吗？只回答是或否，然后一句理由。"
        : "Should we deploy production now? Answer yes or no, then one sentence.";
  }
}
