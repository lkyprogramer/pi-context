import { expect, it } from "vitest";
import { planFold, shouldFold } from "../../src/projection/planner.js";
import { renderFold } from "../../src/projection/render.js";
import { collectBatches } from "../../src/projection/batches.js";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

const ok = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 };
const big = "x".repeat(6000);
const a = (id: string, p: string | null, c: string): NativeEntry => ({ id, parentId: p, type: "message", message: { role: "assistant", stopReason: "toolUse", usage: ok, content: [{ type: "toolCall", id: c, name: "read", arguments: {} }] } });
const r = (id: string, p: string, c: string): NativeEntry => ({ id, parentId: p, type: "message", message: { role: "toolResult", toolCallId: c, toolName: "read", isError: false, content: [{ type: "text", text: `${id}\n${big}` }] } });
const entries: NativeEntry[] = [];
let parent: string | null = null;
for (let i = 1; i <= 8; i++) { entries.push(a(`a${i}`, parent, `c${i}`), r(`r${i}`, `a${i}`, `c${i}`)); parent = `r${i}`; }
entries.push({ id: "a9", parentId: parent, type: "message", message: { role: "assistant", stopReason: "stop", usage: ok, content: [{ type: "text", text: "done" }] } });
const scope: Scope = { workspaceId: "w", sessionId: "s", leafId: "a9", visibleEntryIds: new Set(entries.map((e) => e.id)) };
const cfg = { ...DEFAULT_CONFIG, profile: "balanced" as const };

it("folds oldest exposed results above trigger, freezes them, and leaves the protected tail raw", () => {
  const usage = { tokens: 6500, contextWindow: 10000, percent: 65 };
  expect(shouldFold(usage, null, cfg.fold)).toBe(true);
  const batches = collectBatches(entries);
  const plan = planFold({ scope, entries, batches, exposed: exposedEntryIds(entries), usage, previous: null, modelId: "m", cfg, configHash: "h" });
  expect(plan).not.toBeNull();
  const keys = [...plan!.replacements.keys()];
  expect(keys).toContain("r1:0");
  expect(keys).not.toContain("r8:0");
  const messages = entries.filter((e) => e.type === "message").map((e) => structuredClone(e.message));
  const mapping = new Map(messages.map((m, i) => [i, { entryId: entries[i].id }]));
  const out = renderFold(messages as never, plan!, mapping);
  expect(out.applied).toBe(keys.length);
  const stub = (out.messages[1] as { content: { text: string }[] }).content[0].text;
  expect(stub).toMatch(/pctx folded tool result/);
  expect(stub).toMatch(/pctx:6:/);
  const again = renderFold(entries.filter((e) => e.type === "message").map((e) => structuredClone(e.message)) as never, plan!, mapping);
  expect((again.messages[1] as { content: { text: string }[] }).content[0].text).toBe(stub);
  expect(shouldFold({ tokens: 6600, contextWindow: 10000, percent: 66 }, plan, cfg.fold)).toBe(false);
});

it("appends replacements without rewriting previous stub objects", () => {
  const usage = { tokens: 6500, contextWindow: 10000, percent: 65 };
  const batches = collectBatches(entries);
  const first = planFold({ scope, entries, batches, exposed: exposedEntryIds(entries), usage, previous: null, modelId: "m", cfg, configHash: "h" });
  expect(first).not.toBeNull();
  const old = first!.replacements.get("r1:0");
  const cfgAppend = { ...cfg, fold: { ...cfg.fold, minRemovedTokens: 8 } };
  const grown = { tokens: 9500, contextWindow: 10000, percent: 95 };
  expect(shouldFold(grown, first, cfgAppend.fold)).toBe(true);
  const second = planFold({ scope, entries, batches, exposed: exposedEntryIds(entries), usage: grown, previous: first, modelId: "m", cfg: cfgAppend, configHash: "h" });
  expect(second).not.toBeNull();
  expect(second!.replacements.get("r1:0")).toBe(old);
  expect(second!.replacements.size).toBeGreaterThanOrEqual(first!.replacements.size);
});
