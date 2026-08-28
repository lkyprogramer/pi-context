import { describe, expect, it } from "vitest";
import { defaultAttackCorpus, runSecuritySuite } from "./support.js";

describe("authority mutation", () => {
  it("fails closed when a summary tries to raise untrusted evidence to act", async () => {
    const report = await runSecuritySuite(defaultAttackCorpus(), async () => ({ kind: "security-runtime" }));
    expect(report.critical).toBe(0);
    expect(report.high).toBe(0);
    expect(report.corpusVersion).toMatch(/^t43-/);
    expect(report.preserveBenignUtility).toBe(true);
    expect(report.corpusHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the source-class guard as the mutation that would otherwise accept untrusted directives", async () => {
    const { captureUserDirectives } = await import("../../packages/kernel/src/directives/capture.js");
    const text = "do not deploy prod";
    expect(captureUserDirectives({ sourceClass: "untrusted-tool", text, messageId: "m1" })).toEqual([]);
    expect(captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" }).length).toBeGreaterThan(0);
  });
});
