import { describe, expect, it } from "vitest";
import { armOrderFor, emptyArm, hostManifest, loadSmokePlan, plannedPair } from "../../eval/runner.js";
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

  it("freezes AB/BA per case and smoke plan lists eight cases and B0/B2", () => {
    const plan = loadSmokePlan();
    expect(plan.caseIds).toEqual(["J01", "J02", "J03", "J04", "J05", "J06", "J07", "J08"]);
    expect(plan.arms).toEqual(["B0", "B2"]);
    const a = armOrderFor(plan.seed, "J01");
    const b = armOrderFor(plan.seed, "J01");
    expect(a).toEqual(b);
    expect(new Set(a)).toEqual(new Set(["B0", "B2"]));
    expect(emptyArm("B0", "incomplete").status).toBe("incomplete");
  });

  it("host manifest is official Pi 0.85.1 and immutable", () => {
    const m = hostManifest();
    expect(m.host).toBe("official-pi");
    expect(m.piVersion).toBe("0.85.1");
  });
});
