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
