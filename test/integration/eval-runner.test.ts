import { describe, expect, it } from "vitest";
import { plannedPair } from "../../eval/runner.js";
import { freezeManifest } from "../../eval/manifest.js";

describe("T22 eval runner", () => {
  it("keeps planned arms in the denominator and never fills missing cost with 0", () => {
    const pair = plannedPair("J01", "java");
    expect(pair.baseline.taskPassed).toBeNull();
    expect(pair.candidate.monetaryCost).toBeNull();
    expect(["not-run", "blocked"]).toContain(pair.baseline.status);
    const m = freezeManifest({
      host: "official-pi",
      piVersion: "0.85.1",
      sourceRevision: "x",
      configHash: "y",
      model: "unset",
      pricingIdentity: null,
    });
    expect(m.immutable).toBe(true);
    expect(() => {
      (m as { model: string }).model = "other";
    }).toThrow();
  });
});
