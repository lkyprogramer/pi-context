import { describe, expect, it } from "vitest";
import { plannedPair } from "../../eval/runner.js";
import { honest, summarize } from "../../eval/report.js";

describe("T24 report", () => {
  it("n=0/not-run stays not-run and missing cost is not 0", () => {
    const pairs = [plannedPair("J01", "java")];
    const s = summarize(pairs);
    expect(s.complete).toBe(0);
    expect(honest(pairs)).toBe(true);
    expect(pairs[0]?.candidate.monetaryCost).not.toBe(0);
  });
});
