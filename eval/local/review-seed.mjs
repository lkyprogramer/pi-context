/**
 * Deterministic legal Pi 0.85.1 JSONL seeds for Q/C review cases.
 * Witness lives in an old paired toolResult. Final prompt is not part of the seed.
 * Fold cases stamp last-assistant usage at 65% of w64k and pad old dumps so a real fold can remove ≥4096 tokens.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewFixture } from "./scenarios.mjs";

export const REVIEW_CONTEXT_WINDOW = 65_536;
export const FOLD_USAGE_PERCENT = 65;
export const NO_FOLD_USAGE_PERCENT = 30;
const MODEL = "openclaw/Qwen3.8-27B-WORK";
const TS0 = Date.parse("2026-09-10T00:00:00.000Z");
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

export function targetTokens(requiresFold, window = REVIEW_CONTEXT_WINDOW, percent) {
  const pct = percent ?? (requiresFold ? FOLD_USAGE_PERCENT : NO_FOLD_USAGE_PERCENT);
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

function docsCorpus(root = repoRoot) {
  const docs = join(root, "docs");
  if (!existsSync(docs)) return "";
  const names = readdirSync(docs).filter((n) => n.endsWith(".md")).sort();
  const chunks = [];
  for (const name of names) {
    try { chunks.push(readFileSync(join(docs, name), "utf8")); } catch { /* skip */ }
  }
  return chunks.join("\n");
}

function sliceDocs(corpus, offsetWords, tokens, dumpIndex) {
  const words = corpus.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const fallback = "repo-docs-empty-pool filler word".split(" ");
    return sliceDocs(fallback.join(" "), offsetWords, tokens, dumpIndex);
  }
  const out = [];
  let wrap = 0;
  let i = 0;
  while (out.length < tokens) {
    const idx = (offsetWords + i) % words.length;
    if (idx === 0 && i > 0) wrap += 1;
    out.push(words[idx]);
    i += 1;
  }
  const header = wrap > 0
    ? `[dump-${dumpIndex} offset=${offsetWords} wrap=${wrap}]`
    : `[dump-${dumpIndex} offset=${offsetWords}]`;
  return `${header}\n${out.join(" ")}`;
}

function padBlock(label, tokens, fx) {
  if (fx?.padSource === "repo-docs") {
    const n = Number(String(label).replace(/\D/g, "") || "1") || 1;
    return scrubSecrets(sliceDocs(docsCorpus(), n * (tokens + 17), tokens, n), fx);
  }
  return uniquePad(label, tokens);
}

export function warmupFiles(fx, root = repoRoot) {
  const tokensEach = fx.warmup?.tokensEach ?? 6000;
  const corpus = docsCorpus(root);
  const seedPadWords = fx.requiresFold ? 1_550 * 6 : 80;
  return [
    { name: "dump-a.txt", text: scrubSecrets(sliceDocs(corpus, seedPadWords + 100, tokensEach, "a"), fx) },
    { name: "dump-b.txt", text: scrubSecrets(sliceDocs(corpus, seedPadWords + 100 + tokensEach + 50, tokensEach, "b"), fx) },
  ];
}

function scrubSecrets(text, fx) {
  if (!fx) return text;
  let out = text;
  for (const secret of [fx.witness, fx.witnessB, fx.oracle?.keyA, fx.oracle?.keyB].filter((s) => typeof s === "string" && s.length > 1)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
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
  const pct = fx.seedUsagePercent ?? (fx.requiresFold === true ? FOLD_USAGE_PERCENT : NO_FOLD_USAGE_PERCENT);
  const tokens = targetTokens(fx.requiresFold === true, window, pct);
  const oldPad = fx.requiresFold ? 1_550 : 80;
  const b = new SeedBuilder(fx.id);

  if (fx.id === "Q07" || fx.base === "Q07" || fx.id === "W-Q07") {
    const readA = { id: "call-readA", name: "read", path: "check-a.txt" };
    const readB = { id: "call-readB", name: "read", path: "check-b.txt" };
    b.user("read both check records from the earlier batch");
    b.assistantTool([readA, readB], 120);
    b.result(readA, `${fx.seedText}\nkeyA=${fx.oracle.keyA}\n${padBlock("pad-a", oldPad, fx)}`);
    b.result(readB, `${STUB_HEAD_PREAMBLE}\nkeyB=${fx.oracle.keyB}\n${padBlock("pad-b", oldPad, fx)}`);
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
    const witnessPad = fx.id === "C01" ? "" : padBlock("witness-pad", oldPad, fx);
    turn(b, first, "read the recorded notes from earlier work; do not repeat them later", witnessBody(fx) + witnessPad);
    if (fx.id === "Q05" || fx.base === "Q05" || fx.id === "W-Q05") {
      turn(b, { id: "call-q05-error", name: "read", path: "probe-error.log" }, "transient probe failed", "probe failed: timeout, not the reservation assertion\n", { isError: true });
    }
    if (fx.id === "Q06") {
      turn(b, { id: "call-sibling", name: "read", path: "sibling-ticket.txt" }, "sibling-branch ticket is not selected", "[sibling-branch] ticket=TK-991\n");
    }
  }

  const extraOld = fx.id === "Q07" || fx.id === "W-Q07" ? 4 : fx.requiresFold ? 5 : 0;
  for (let i = 1; i <= extraOld; i++) {
    const call = { id: `call-old-${i}`, name: "read", path: `old-${i}.log` };
    turn(b, call, `continue reviewing dump ${i}`, padBlock(`old-${i}`, oldPad, fx));
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
