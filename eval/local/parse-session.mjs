#!/usr/bin/env node
/**
 * Recompute request/tool/compaction/history counters from a Pi 0.85.1 session JSONL (offline, no model).
 * Used by tests (test/unit/local-cases.test.ts) and by run-episode.mjs as the source of truth for
 * historyReads / historySearches / verifiedReads (not the plugin's self-reported status).
 *
 *   node parse-session.mjs <session.jsonl>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function parseHistoryMetadata(text) {
  if (typeof text !== "string" || !text.startsWith("{")) return null;
  try {
    const o = JSON.parse(text);
    if (o && typeof o === "object" && ("verified" in o || "code" in o || "sourceHash" in o)) return o;
  } catch {
    /* not metadata */
  }
  return null;
}

export function sha256Utf8(text) {
  return createHash("sha256").update(Buffer.from(String(text), "utf8")).digest("hex");
}

export function pageOfHistoryResult(texts) {
  if (!texts.length) return "";
  if (parseHistoryMetadata(texts[0])) return texts.slice(1).join("\n");
  return texts.join("\n");
}

export function parseSession(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().startsWith("{"));
  const requests = [], toolCalls = [];
  let compactions = 0, historyReads = 0, historySearches = 0, verifiedReads = 0;
  const callNames = new Map();
  const errorResultIds = [];
  const historyReadResults = [];
  const sourceBlocks = [];
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "compaction") {
      compactions++;
      const u = e.usage ?? e.message?.usage;
      if (u && typeof u === "object") {
        requests.push({
          entryId: e.id ?? `compaction-${compactions}`,
          requestId: e.id ?? `compaction-${compactions}`,
          purpose: "compaction",
          source: "pi-disjoint",
          input: u.input ?? null, output: u.output ?? null, cacheRead: u.cacheRead ?? null,
          cacheWrite: u.cacheWrite ?? null, totalTokens: u.totalTokens ?? null, stopReason: "compaction",
        });
      }
      continue;
    }
    if (e.type !== "message" || !e.message) continue;
    const m = e.message;
    if (m.role === "assistant") {
      const u = m.usage ?? {};
      requests.push({
        entryId: e.id,
        requestId: e.id,
        purpose: "agent",
        source: "pi-disjoint",
        input: u.input ?? null, output: u.output ?? null, cacheRead: u.cacheRead ?? null,
        cacheWrite: u.cacheWrite ?? null, totalTokens: u.totalTokens ?? null, stopReason: m.stopReason ?? null,
      });
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === "toolCall") {
          callNames.set(b.id, b.name);
          toolCalls.push({ id: b.id, name: b.name, arguments: b.arguments ?? {} });
          if (b.name === "pctx_history") {
            const a = b.arguments ?? {};
            if (a.action === "read") historyReads++;
            else if (a.action === "search") historySearches++;
          }
        }
      }
    } else if (m.role === "toolResult") {
      const t = toolCalls.find((c) => c.id === m.toolCallId);
      if (t) { t.isError = Boolean(m.isError); t.resultBytes = Buffer.byteLength(JSON.stringify(m.content ?? "")); }
      if (m.isError) errorResultIds.push(e.id);
      const texts = textBlocks(m.content);
      if (t?.name === "pctx_history") {
        const meta = texts.map(parseHistoryMetadata).find(Boolean);
        const page = pageOfHistoryResult(texts);
        const empty = page.length === 0;
        const verified = meta?.verified === true;
        if (verified && !empty) verifiedReads++;
        historyReadResults.push({
          toolCallId: m.toolCallId,
          entryId: e.id,
          verified,
          empty,
          page,
          sourceHash: typeof meta?.sourceHash === "string" ? meta.sourceHash : null,
        });
      } else {
        for (const text of texts) {
          sourceBlocks.push({ entryId: e.id, text, hash: sha256Utf8(text) });
        }
      }
    }
  }
  const known = requests.filter((r) => r.input != null);
  const logicals = requests.map((r) => (r.input != null && r.cacheRead != null && r.cacheWrite != null ? r.input + r.cacheRead + r.cacheWrite : null));
  const unknownLogical = logicals.filter((n) => n == null).length;
  return {
    entries: lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean),
    requests, toolCalls, compactions, historyReads, historySearches, verifiedReads, errorResultIds,
    historyReadResults, sourceBlocks,
    sums: {
      input: known.reduce((s, r) => s + r.input, 0),
      cacheRead: requests.filter((r) => r.cacheRead != null).reduce((s, r) => s + r.cacheRead, 0),
      output: requests.filter((r) => r.output != null).reduce((s, r) => s + r.output, 0),
      unknownUsage: requests.length - known.length,
      knownLogicalSubtotal: logicals.filter((n) => n != null).reduce((s, n) => s + n, 0),
      logicalInput: unknownLogical ? null : logicals.reduce((s, n) => s + n, 0),
    },
  };
}

export function nonceEntryIds(parsed, nonce) {
  if (!nonce) return [];
  const needle = String(nonce).trim();
  if (!needle) return [];
  const ids = [];
  for (const e of parsed.entries) {
    if (e.type !== "message" || e.message?.role !== "toolResult") continue;
    if (textOf(e.message.content).includes(needle)) ids.push(e.id);
  }
  return ids;
}

export function nonceSourceHashes(parsed, nonce) {
  const needle = String(nonce ?? "").trim();
  if (!needle) return [];
  return (parsed.sourceBlocks ?? []).filter((b) => b.text.includes(needle)).map((b) => b.hash);
}

/** Verified, non-empty page containing the nonce, whose sourceHash matches a nonce-bearing original block. */
export function nonceVerifiedReads(parsed, nonce) {
  const needle = String(nonce ?? "").trim();
  if (!needle || !parsed) return 0;
  const hashes = new Set(nonceSourceHashes(parsed, needle));
  if (!hashes.size) return 0;
  let n = 0;
  for (const r of parsed.historyReadResults ?? []) {
    if (!r.verified || r.empty) continue;
    if (!String(r.page).includes(needle)) continue;
    if (!r.sourceHash || !hashes.has(r.sourceHash)) continue;
    n++;
  }
  return n;
}

export function nonceToolResultBytes(parsed, nonce) {
  const needle = String(nonce ?? "").trim();
  if (!needle) return 0;
  let max = 0;
  for (const b of parsed.sourceBlocks ?? []) {
    if (!b.text.includes(needle)) continue;
    max = Math.max(max, Buffer.byteLength(b.text, "utf8"));
  }
  return max;
}

export function foldedErrorCount(errorResultIds, foldedEntryIds) {
  const folded = new Set(foldedEntryIds ?? []);
  return (errorResultIds ?? []).filter((id) => folded.has(id)).length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(parseSession(process.argv[2]), null, 2));
}

function textBlocks(content) {
  if (typeof content === "string") return [content];
  return (Array.isArray(content) ? content : []).filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text);
}

function textOf(content) {
  return textBlocks(content).join("\n");
}

/**
 * Lost-critical-evidence probe (H02): did an assistant message written AFTER `sinceMs` quote, verbatim, the line that
 * matches `linePattern` inside an earlier `isError=true` toolResult? Returns null when no such source line exists
 * (unknown), true/false otherwise. Whitespace is collapsed on both sides; nothing else is normalised.
 */
export function verbatimQuote(parsed, { linePattern, sinceMs }) {
  const re = new RegExp(linePattern);
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  let sourceLine = null;
  for (const e of parsed.entries) {
    if (e.type !== "message" || e.message?.role !== "toolResult" || !e.message.isError) continue;
    const line = textOf(e.message.content).split("\n").find((l) => re.test(l));
    if (line) { sourceLine = norm(line); break; }
  }
  if (!sourceLine) return null;
  for (const e of parsed.entries) {
    if (e.type !== "message" || e.message?.role !== "assistant") continue;
    if (sinceMs && new Date(e.timestamp).getTime() < sinceMs) continue;
    if (norm(textOf(e.message.content)).includes(sourceLine)) return true;
  }
  return false;
}
