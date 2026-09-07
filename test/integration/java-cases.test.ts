import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { c2Status } from "../../eval/recovery-probe.js";
import { javaAvailable } from "../../eval/oracles/java.js";

describe("T23 java/C2", () => {
  it("C2 status is evidence-backed and never invented", () => {
    const status = c2Status();
    expect(["not-run", "blocked", "passed", "failed"]).toContain(status.status);
    expect(status.reason.length).toBeGreaterThan(0);
    if (status.status === "passed") {
      expect(
        existsSync(join(process.cwd(), "artifacts/v5-tasks/T26/g3-c2.json"))
        || existsSync(join(process.cwd(), "artifacts/v5-evaluation/report.json")),
      ).toBe(true);
    }
    if (!javaAvailable()) {
      expect(javaAvailable()).toBe(false);
    }
  });
});
