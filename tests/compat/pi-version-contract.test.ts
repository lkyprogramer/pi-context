import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PINNED_PI_VERSION, readCompatLock } from "../../scripts/install-pi-version.mjs";
import { scanImports, verifyPiCompatibility } from "../../scripts/check-public-pi-imports.mjs";
import { createPiContractHarness } from "../../packages/testkit/src/pi-contract-harness.js";

describe("Pi public API boundary", () => {
  it("rejects source-path and unexported Pi imports", async () => {
    const findings = await scanImports(["packages/pi-adapter", "apps/pi-context-runtime"]);
    expect(findings).toEqual([]);
  });

  it("locks 0.84.3 and keeps handler chaining plus custom-entry exclusion", async () => {
    const lock = readCompatLock();
    expect(lock.baseline.version).toBe(PINNED_PI_VERSION);
    expect(lock.tested).toContain("0.84.3");
    expect(lock.supportedRange).toBe(">=0.84.3 <0.85.0");
    expect(lock.modes).toEqual(expect.arrayContaining(["tui", "rpc", "print"]));
    const harness = createPiContractHarness();
    const report = await verifyPiCompatibility("0.84.3", {
      ...harness,
      probeCapabilities: async () => harness.probe(),
    });
    expect(report.ready).toBe(true);
    expect(report.contracts.find((item) => item.name === "handler-chaining")?.ok).toBe(true);
    expect(report.contracts.find((item) => item.name === "custom-entry-excluded")?.ok).toBe(true);
  });

  it("keeps the compatibility workflow covering min/current/latest lanes", () => {
    const workflow = readFileSync(".github/workflows/compatibility.yml", "utf8");
    expect(workflow).toMatch(/lane: \[min, current\]/);
    expect(workflow).toMatch(/lane: latest/);
    const matrix = readFileSync("reference/ci-matrix.yml", "utf8");
    expect(matrix).toMatch(/min: "0\.84\.3"/);
    expect(matrix).toMatch(/latest: advisory/);
  });
});
