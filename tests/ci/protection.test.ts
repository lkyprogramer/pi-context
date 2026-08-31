import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRequiredJobs } from "../../scripts/ci/verify-protection.mjs";

describe("required CI protection contract", () => {
  it("lists every required job in required.yml", () => {
    const text = readFileSync(".github/workflows/required.yml", "utf8");
    expect(assertRequiredJobs(text)).toContain("unit");
    expect(text.includes("continue-on-error:")).toBe(false);
  });

  it("treats a skipped required job list as failure", () => {
    try {
      assertRequiredJobs("name: required\njobs:\n  unit:\n    runs-on: ubuntu-latest\n");
      throw new Error("expected missing jobs to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "PCR_CI_REQUIRED_JOBS_MISSING" });
    }
  });
});
