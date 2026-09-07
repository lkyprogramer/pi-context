import { describe, expect, it } from "vitest";
import { collectBatches, protectSet } from "../../src/projection/batches.js";
import { assistantEntry, toolResultEntry, userEntry, textBlocks } from "../../src/testing.js";

describe("T11 batches", () => {
  it("incomplete batches are not reducible", () => {
    const entries = [
      userEntry("u", null, textBlocks("go")),
      assistantEntry("a", "u", [{ type: "toolCall", id: "c1" }, { type: "toolCall", id: "c2" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("one")),
    ];
    const batches = collectBatches(entries);
    expect(batches[0]?.complete).toBe(false);
    const protect = protectSet(batches, 4);
    expect(protect.has("a")).toBe(true);
    expect(protect.has("r1")).toBe(true);
  });
});
