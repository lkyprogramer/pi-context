import { describe, expect, it } from "vitest";
import { planFold, planStillValid, shouldFold } from "../../src/projection/planner.js";
import { collectBatches } from "../../src/projection/batches.js";
import { exposedEntryIds } from "../../src/projection/exposed.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

describe("T13 planner", () => {
  it("does not plan when percent is null or below trigger", () => {
    expect(shouldFold({ tokens: 10, contextWindow: 1000, percent: null }, null, DEFAULT_CONFIG.fold)).toBe(false);
    expect(shouldFold({ tokens: 10, contextWindow: 1000, percent: 10 }, null, DEFAULT_CONFIG.fold)).toBe(false);
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a", "u", [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("x".repeat(8000))),
    ];
    const plan = planFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "r1", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: exposedEntryIds(entries),
      usage: { tokens: 100, contextWindow: 1000, percent: 10 },
      previous: null,
      modelId: "m",
      cfg: DEFAULT_CONFIG,
      configHash: "h",
    });
    expect(plan).toBeNull();
  });

  function expose(entry: ReturnType<typeof assistantEntry>) {
    entry.message!.usage = { input: 100, totalTokens: 100 };
    return entry;
  }

  function foldCfg(overrides: Partial<typeof DEFAULT_CONFIG.fold> = {}) {
    return { ...DEFAULT_CONFIG, fold: { ...DEFAULT_CONFIG.fold, protectRecentBatches: 1, minRemovedTokens: 4096, minFoldableBytes: 1024, ...overrides } };
  }

  it("does not fold isError results and stops once estimated usage is at target", () => {
    const big = "x".repeat(20_000);
    const mid = "y".repeat(16_000);
    const extra = "z".repeat(16_000);
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a1", "u", [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a1", "c1", textBlocks(big)),
      expose(assistantEntry("d1", "r1", textBlocks("ok"))),
      assistantEntry("a2", "d1", [{ type: "toolCall", id: "c2" }]),
      (() => { const r = toolResultEntry("r2", "a2", "c2", textBlocks(mid)); r.message!.isError = true; return r; })(),
      expose(assistantEntry("d2", "r2", textBlocks("err-seen"))),
      assistantEntry("a3", "d2", [{ type: "toolCall", id: "c3" }]),
      toolResultEntry("r3", "a3", "c3", textBlocks(extra)),
      expose(assistantEntry("d3", "r3", textBlocks("ok"))),
      assistantEntry("a4", "d3", [{ type: "toolCall", id: "c4" }]),
      toolResultEntry("r4", "a4", "c4", textBlocks(extra)),
      expose(assistantEntry("d4", "r4", textBlocks("ok"))),
    ];
    const cfg = foldCfg();
    const plan = planFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "d4", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: exposedEntryIds(entries),
      usage: { tokens: 14_000, contextWindow: 20_000, percent: 70 },
      previous: null,
      modelId: "m",
      cfg,
      configHash: "h",
    });
    expect(plan).not.toBeNull();
    const keys = [...(plan?.replacements.keys() ?? [])];
    expect(keys.some((k) => k.startsWith("r2:"))).toBe(false);
    expect(keys.some((k) => k.startsWith("r1:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("r4:"))).toBe(false);
  });

  it("abandons a plan that reaches target before minRemovedTokens instead of folding further", () => {
    const first = "a".repeat(13_000);
    const second = "b".repeat(20_000);
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a1", "u", [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a1", "c1", textBlocks(first)),
      expose(assistantEntry("d1", "r1", textBlocks("ok"))),
      assistantEntry("a2", "d1", [{ type: "toolCall", id: "c2" }]),
      toolResultEntry("r2", "a2", "c2", textBlocks(second)),
      expose(assistantEntry("d2", "r2", textBlocks("ok"))),
      assistantEntry("a3", "d2", [{ type: "toolCall", id: "c3" }]),
      toolResultEntry("r3", "a3", "c3", textBlocks(second)),
      expose(assistantEntry("d3", "r3", textBlocks("ok"))),
    ];
    const plan = planFold({
      scope: { workspaceId: "w", sessionId: "s", leafId: "d3", visibleEntryIds: new Set(entries.map((e) => e.id)) },
      entries,
      batches: collectBatches(entries),
      exposed: exposedEntryIds(entries),
      usage: { tokens: 7000, contextWindow: 10_000, percent: 70 },
      previous: null,
      modelId: "m",
      cfg: foldCfg({ minRemovedTokens: 4096, targetPercent: 40 }),
      configHash: "h",
    });
    expect(plan).toBeNull();
  });

  it("invalidates a plan when the compaction boundary changes", () => {
    const plan = {
      planId: "p",
      sessionId: "s",
      compactionBoundary: "c1",
      modelId: "m",
      configHash: "h",
      createdAt: "t",
      usagePercentAtPlan: 65,
      replacements: new Map(),
      savedTokensEstimate: 0,
    };
    expect(planStillValid(plan, { sessionId: "s", compactionBoundary: "c2", modelId: "m", configHash: "h" })).toBe(false);
  });
});
