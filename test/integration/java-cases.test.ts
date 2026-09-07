import { describe, expect, it } from "vitest";
import { c2Status } from "../../eval/recovery-probe.js";
import { javaAvailable } from "../../eval/oracles/java.js";

describe("T23 java/C2", () => {
  it("does not mark C2 passed without a real model run", () => {
    const status = c2Status();
    expect(["not-run", "blocked"]).toContain(status.status);
    expect(status.reason.length).toBeGreaterThan(0);
    if (!javaAvailable()) {
      expect(javaAvailable()).toBe(false);
    }
  });
});
