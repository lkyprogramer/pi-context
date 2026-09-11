/**
 * Deterministic legal Pi 0.85.1 JSONL seeds for Q/C review cases.
 * Witness lives in an old paired toolResult. Final prompt is not part of the seed.
 * Fold cases stamp last-assistant usage at 65% of w64k and pad old dumps so a real fold can remove ≥4096 tokens.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadReviewFixture } from "./scenarios.mjs";

export const REVIEW_CONTEXT_WINDOW = 65_536;
export const FOLD_USAGE_PERCENT = 65;
export const NO_FOLD_USAGE_PERCENT = 30;
const MODEL = "openclaw/Qwen3.8-27B-WORK";
const TS0 = Date.parse("2026-09-10T00:00:00.000Z");

export function targetTokens(requiresFold, window = REVIEW_CONTEXT_WINDOW) {
  const pct = requiresFold ? FOLD_USAGE_PERCENT : NO_FOLD_USAGE_PERCENT;
  return Math.ceil((window * pct) / 100);
}

function usage(totalTokens) {
  return {
    input: totalTokens,
    output: 8,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function uniquePad(label, tokens) {
  const words = new Array(tokens);
  for (let i = 0; i < tokens; i++) words[i] = `${label}${i.toString(36)}`;
  return words.join(" ");
}

function padBlock(label, tokens) {
  return uniquePad(label, tokens);
}

export const C01_SAMPLE_MIN_BYTES = 14_000;
export const C01_SAMPLE_MAX_BYTES = 18_000;
export const C01_TAIL_MARKER = "c01-end-8f3a-page2";
export const STUB_HEAD_PREAMBLE = "前期工具记录，本行只作折叠头，不含判定值。";

export function stubHeadOf(text, maxChars = 120) {
  if (!text.includes("\n") && !text.includes("\r")) return text.slice(0, maxChars);
  const first = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  return first.slice(0, maxChars);
}

export function c01SampleInfo(fx) {
  const unit = "折叠后仍须按UTF-8还原🧩🌳";
  const pages = [];
  const body = () => `${fx.seedText}\n${pages.join("\n")}${pages.length ? "\n" : ""}`;
  for (let i = 0; Buffer.byteLength(body(), "utf8") < C01_SAMPLE_MIN_BYTES; i++) {
    pages.push(`${unit} p=${i} ${(Math.imul(i, 2654435761) >>> 0).toString(16)}`);
    if (i > 800) break;
  }
  const text = `${body()}${C01_TAIL_MARKER}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > C01_SAMPLE_MAX_BYTES) {
    throw new Error(`C01 sample ${bytes} exceeds ${C01_SAMPLE_MAX_BYTES}`);
  }
  return { text, lastLine: C01_TAIL_MARKER, nonce: fx.witness, bytes, pageCount: pages.length };
}

function witnessBody(fx) {
  if (fx.id === "C01") return c01SampleInfo(fx).text;
  if (fx.id === "C02") return `${fx.seedText}\ncurrent-branch needle-alpha\n`;
  if (fx.id === "Q07") return `${fx.seedText}\nkeyA=${fx.oracle.keyA}\n`;
  return `${fx.seedText}\n`;
}

class SeedBuilder {
  constructor(caseId) {
    this.lines = [];
    this.seq = 0;
    this.parent = null;
    this.sessionId = `revseed00-0000-4000-8000-${caseId.toLowerCase().padEnd(12, "0").slice(0, 12)}`;
    this.lines.push({
      type: "session",
      version: 3,
      id: this.sessionId,
      timestamp: this.ts(),
      cwd: "/work",
    });
    const modelId = this.nid();
    this.lines.push({
      type: "model_change",
      id: modelId,
      parentId: null,
      timestamp: this.ts(),
      provider: "work",
      modelId: MODEL,
    });
    this.parent = modelId;
    const thinkId = this.nid();
    this.lines.push({
      type: "thinking_level_change",
      id: thinkId,
      parentId: this.parent,
      timestamp: this.ts(),
      thinkingLevel: "medium",
    });
    this.parent = thinkId;
  }

  nid() {
    this.seq += 1;
    return this.seq.toString(16).padStart(8, "0");
  }

  ts() {
    return new Date(TS0 + this.seq * 1000).toISOString();
  }

  add(partial) {
    const id = this.nid();
    const row = { id, parentId: this.parent, timestamp: this.ts(), ...partial };
    this.lines.push(row);
    this.parent = id;
    return id;
  }

  user(text) {
    this.add({
      type: "message",
      message: { role: "user", content: [{ type: "text", text }], timestamp: TS0 + this.seq * 1000 },
    });
  }

  assistantTool(calls, tokens = 80) {
    const content = calls.map((c) => ({
      type: "toolCall",
      id: c.id,
      name: c.name ?? "read",
      arguments: c.arguments ?? { path: c.path ?? "notes.txt" },
    }));
    this.add({
      type: "message",
      message: {
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "work",
        model: MODEL,
        usage: usage(tokens),
        stopReason: "toolUse",
        timestamp: TS0 + this.seq * 1000,
      },
    });
  }

  result(call, text, extra = {}) {
    this.add({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name ?? "read",
        content: [{ type: "text", text }],
        isError: extra.isError === true,
        timestamp: TS0 + this.seq * 1000,
      },
    });
  }

  assistantDone(tokens) {
    this.add({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "recorded" }],
        api: "openai-completions",
        provider: "work",
        model: MODEL,
        usage: usage(tokens),
        stopReason: "stop",
        timestamp: TS0 + this.seq * 1000,
      },
    });
  }

  jsonl() {
    return `${this.lines.map((row) => JSON.stringify(row)).join("\n")}\n`;
  }
}

function turn(builder, call, userText, body, opts = {}) {
  builder.user(userText);
  builder.assistantTool([call], opts.assistantTokens ?? 80);
  builder.result(call, body, opts);
}

export function buildReviewSeed(fx, opts = {}) {
  const window = opts.contextWindow ?? REVIEW_CONTEXT_WINDOW;
  const tokens = targetTokens(fx.requiresFold === true, window);
  // Measured on Qwen3.8-27B-WORK: result words ≈ 4.8 tokens. 6×1550 ≈ 44k
  // input (67% of w64k), inside the 60–75% fold band and below native compact.
  const oldPad = fx.requiresFold ? 1_550 : 80;
  const b = new SeedBuilder(fx.id);

  if (fx.id === "Q07") {
    const readA = { id: "call-readA", name: "read", path: "check-a.txt" };
    const readB = { id: "call-readB", name: "read", path: "check-b.txt" };
    b.user("read both check records from the earlier batch");
    b.assistantTool([readA, readB], 120);
    b.result(readA, `${fx.seedText}\nkeyA=${fx.oracle.keyA}\n${padBlock("pad-a", oldPad)}`);
    b.result(readB, `${STUB_HEAD_PREAMBLE}\nkeyB=${fx.oracle.keyB}\n${padBlock("pad-b", oldPad)}`);
  } else if (fx.id === "C02") {
    turn(b, { id: "call-alpha", name: "read", path: "branch-notes.txt" }, "read current-branch notes", `${fx.seedText}\ncurrent-branch needle-alpha\n`);
    turn(b, { id: "call-beta", name: "read", path: "branch-notes-2.txt" }, "read the second current-branch note", `${STUB_HEAD_PREAMBLE}\ncurrent-branch needle-beta\n`);
    turn(b, { id: "call-decoy", name: "read", path: "sibling.txt" }, "ignore sibling-branch leftovers", "[sibling-branch] decoy-gamma must not be treated as current\n");
    for (let i = 1; i <= 12; i++) {
      const call = { id: `call-pad-${i}`, name: "read", path: `needle-pad-${String(i).padStart(2, "0")}.txt` };
      turn(b, call, `page dump ${i}`, `needle-pad-${String(i).padStart(2, "0")} filler without the legal pair\n${padBlock(`np${i}`, 280)}`);
    }
  } else {
    const first = { id: "call-witness", name: "read", path: "recorded-notes.txt" };
    const witnessPad = fx.id === "C01" ? "" : padBlock("witness-pad", oldPad);
    turn(b, first, "read the recorded notes from earlier work; do not repeat them later", witnessBody(fx) + witnessPad);
    if (fx.id === "Q05") {
      turn(b, { id: "call-q05-error", name: "read", path: "probe-error.log" }, "transient probe failed", "probe failed: timeout, not the reservation assertion\n", { isError: true });
    }
    if (fx.id === "Q06") {
      turn(b, { id: "call-sibling", name: "read", path: "sibling-ticket.txt" }, "sibling-branch ticket is not selected", "[sibling-branch] ticket=TK-991\n");
    }
  }

  const extraOld = fx.id === "Q07" ? 4 : fx.requiresFold ? 5 : 0;
  for (let i = 1; i <= extraOld; i++) {
    const call = { id: `call-old-${i}`, name: "read", path: `old-${i}.log` };
    turn(b, call, `continue reviewing dump ${i}`, padBlock(`old-${i}`, oldPad));
  }
  for (let i = 1; i <= 4; i++) {
    const call = { id: `call-recent-${i}`, name: "read", path: `recent-${i}.txt` };
    turn(b, call, `recent checkpoint ${i}`, `recent-${i} ok\n`);
  }
  b.assistantDone(tokens);

  const jsonl = b.jsonl();
  const parsed = jsonl.trim().split("\n").map((line) => JSON.parse(line));
  return {
    jsonl,
    entries: parsed,
    sessionId: b.sessionId,
    targetTokens: tokens,
    meta: {
      caseId: fx.id,
      requiresFold: fx.requiresFold,
      targetTokens: tokens,
      contextWindow: window,
      witness: fx.witness,
    },
  };
}

export function seedTextBlob(entries) {
  return entries
    .filter((row) => row.type === "message")
    .map((row) => JSON.stringify(row.message ?? {}))
    .join("\n");
}

export function ensureReviewSeed(spec, opts = {}) {
  const fx = loadReviewFixture(spec.id);
  const built = buildReviewSeed(fx, opts);
  const dest = opts.dest ?? spec.seed;
  if (!dest) throw new Error(`review seed dest missing for ${spec.id}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, built.jsonl);
  return { dest, ...built };
}
