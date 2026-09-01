import { describe, expect, it } from "vitest";
import { LANES } from "../meta/lane-globs.js";

describe("test lane selection", () => {
  it("keeps unit, integration, packed includes disjoint", () => {
    const unit = new Set(LANES.unit.include);
    const integration = new Set(LANES["hermetic-integration"].include);
    const packed = new Set(LANES["packed-install"].include);
    for (const file of packed) {
      expect(unit.has(file)).toBe(false);
    }
    expect(packed.has("tests/acceptance/packed-install.test.ts")).toBe(true);
    expect(integration.has("tests/acceptance/packed-install.test.ts")).toBe(false);
  });

  it("does not put live-gate files in unit or packed includes", () => {
    expect(LANES.unit.include.some((pattern) => pattern.includes("live-gate"))).toBe(false);
    expect(LANES["packed-install"].include.some((pattern) => pattern.includes("live-gate"))).toBe(false);
    expect(LANES.unit.exclude.some((pattern) => pattern.includes("live-gate"))).toBe(true);
  });
});
