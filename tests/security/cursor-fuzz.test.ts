import { describe, expect, it } from "vitest";
import { defaultAttackCorpus, runSecuritySuite } from "./support.js";

describe("cursor fuzz", () => {
  it("rejects a forged leaf and a tampered blob without weakening the gate", async () => {
    const report = await runSecuritySuite(
      {
        version: defaultAttackCorpus().version,
        cases: defaultAttackCorpus().cases.filter((item) => item.kind === "tampered-cursor" || item.kind === "tampered-blob"),
      },
      async () => ({ kind: "security-runtime" }),
    );
    expect(report.critical + report.high).toBe(0);
    expect(report.results.every((item) => item.ok)).toBe(true);
  });
});
