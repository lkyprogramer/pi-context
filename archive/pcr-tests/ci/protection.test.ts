import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRequiredJobs } from "../../scripts/ci/verify-protection.mjs";

describe("required CI protection contract", () => {
  it("lists every required job in required.yml", () => {
    const text = readFileSync(".github/workflows/required.yml", "utf8");
    expect(assertRequiredJobs(text)).toContain("unit");
    expect(assertRequiredJobs(text)).not.toContain("github-protection-advisory");
    const requiredGate = text.slice(text.indexOf("required-gate:"));
    expect(requiredGate).toContain("run-bundle-verify");
    expect(requiredGate).not.toContain("github-protection-advisory");
  });

  it("keeps GitHub protection advisory and does not call GitHub from check:fast", () => {
    const text = readFileSync(".github/workflows/required.yml", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(text).toContain("github-protection-advisory:");
    expect(text).toMatch(/continue-on-error:\s*true/);
    expect(text).not.toMatch(/run-bundle-verify:[\s\S]*verify-protection\.mjs/);
    expect(pkg.scripts["check:fast"]).not.toMatch(/verify-protection|github-protection|GITHUB_TOKEN|GH_TOKEN/u);
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
