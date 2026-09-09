import { describe, expect, it } from "vitest";
import { collectBatches, protectSet } from "../../src/projection/batches.js";
import { toolResultIndex } from "../../src/pi/source-reader.js";
import { assistantEntry, imageBlock, toolResultEntry, userEntry, textBlocks } from "../../src/testing.js";

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
    expect(protect.has("r1")).toBe(true);
    expect(protect.has("a")).toBe(false);
  });

  it("out-of-order results for the same calls are still complete", () => {
    const entries = [
      assistantEntry("a", null, [{ type: "toolCall", id: "c1" }, { type: "toolCall", id: "c2" }]),
      toolResultEntry("r2", "a", "c2", textBlocks("two")),
      toolResultEntry("r1", "a", "c1", textBlocks("one")),
    ];
    expect(collectBatches(entries)[0]?.complete).toBe(true);
  });

  it("duplicate results for one call are incomplete and ambiguous in the index", () => {
    const entries = [
      assistantEntry("a", null, [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a", "c1", textBlocks("one")),
      toolResultEntry("r1b", "a", "c1", textBlocks("dup")),
    ];
    expect(collectBatches(entries)[0]?.complete).toBe(false);
    expect(toolResultIndex(entries).get("c1")).toBe("ambiguous");
  });

  it("protects batches that contain isError results", () => {
    const err = toolResultEntry("r2", "a2", "c2", textBlocks("boom"));
    err.message!.isError = true;
    const entries = [
      assistantEntry("a1", null, [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a1", "c1", textBlocks("ok")),
      assistantEntry("a2", "r1", [{ type: "toolCall", id: "c2" }]),
      err,
    ];
    const protect = protectSet(collectBatches(entries), 0);
    expect(protect.has("r2")).toBe(true);
    expect(protect.has("r1")).toBe(false);
  });

  it("protects batches that contain non-text results", () => {
    const entries = [
      assistantEntry("a1", null, [{ type: "toolCall", id: "c1" }]),
      toolResultEntry("r1", "a1", "c1", textBlocks("ok")),
      assistantEntry("a2", "r1", [{ type: "toolCall", id: "c2" }]),
      toolResultEntry("r2", "a2", "c2", [imageBlock()]),
    ];
    const batches = collectBatches(entries);
    expect(batches.map((b) => b.hasNonText)).toEqual([false, true]);
    const protect = protectSet(batches, 0);
    expect(protect.has("r2")).toBe(true);
    expect(protect.has("r1")).toBe(false);
  });
});
