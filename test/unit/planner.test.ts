import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { collectBatches } from "../../src/projection/batches.js";
import { planEpoch } from "../../src/projection/planner.js";
import { assistantEntry, textBlocks, toolResultEntry, userEntry } from "../../src/testing.js";

describe("T13 planner", () => {
  it("does not plan before enough successful requests", () => {
    const entries = [
      userEntry("u", null, textBlocks("q")),
      assistantEntry("a", "u", [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("x".repeat(8000))),
    ];
    const plan = planEpoch({
      entries,
      batches: collectBatches(entries),
      config: DEFAULT_CONFIG,
    });
    expect(plan).toBeNull();
  });
});
