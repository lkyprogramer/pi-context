#!/usr/bin/env node
/**
 * Recompute request/tool/compaction/history counters from a Pi 0.85.1 session JSONL (offline, no model).
 * Used by tests (test/unit/local-cases.test.ts) and by report.mjs as an independent check of the plugin's telemetry.
 *
 *   node parse-session.mjs <session.jsonl>
 */
import { readFileSync } from "node:fs";

export function parseSession(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().startsWith("{"));
  const requests = [], toolCalls = [];
  let compactions = 0, historyReads = 0, historySearches = 0;
  const callNames = new Map();
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "compaction") { compactions++; continue; }
    if (e.type !== "message" || !e.message) continue;
    const m = e.message;
    if (m.role === "assistant") {
      const u = m.usage ?? {};
      requests.push({ entryId: e.id, input: u.input ?? null, output: u.output ?? null, cacheRead: u.cacheRead ?? null, cacheWrite: u.cacheWrite ?? null, totalTokens: u.totalTokens ?? null, stopReason: m.stopReason ?? null });
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === "toolCall") {
          callNames.set(b.id, b.name);
          toolCalls.push({ id: b.id, name: b.name });
          if (b.name === "pctx_history") { const a = b.arguments ?? {}; if (a.action === "read") historyReads++; else if (a.action === "search") historySearches++; }
        }
      }
    } else if (m.role === "toolResult") {
      const t = toolCalls.find((c) => c.id === m.toolCallId);
      if (t) { t.isError = Boolean(m.isError); t.resultBytes = Buffer.byteLength(JSON.stringify(m.content ?? "")); }
    }
  }
  const known = requests.filter((r) => r.input != null);
  return {
    entries: lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean),
    requests, toolCalls, compactions, historyReads, historySearches,
    sums: { input: known.reduce((s, r) => s + r.input, 0), cacheRead: known.reduce((s, r) => s + (r.cacheRead ?? 0), 0), output: known.reduce((s, r) => s + (r.output ?? 0), 0), unknownUsage: requests.length - known.length },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(parseSession(process.argv[2]), null, 2));
}

function textOf(content) {
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
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
