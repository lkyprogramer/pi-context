import { describe, expect, it } from "vitest";
import { captureUserDirectives } from "../../packages/kernel/src/directives/capture.js";
import { defaultAttackCorpus, FIXTURE_SECRET, runSecuritySuite } from "./support.js";

describe("secret leak", () => {
  it("does not let a period-free dump put a fixture secret into a checkpoint quote or summary", async () => {
    const dump = `do not deploy prod\n# Secret\n${FIXTURE_SECRET}\n${"batch-note\n".repeat(40)}`;
    const [directive] = captureUserDirectives({ sourceClass: "authenticated-user", text: dump, messageId: "m1" });
    expect(directive?.quote).toBe("do not deploy prod");
    expect(directive?.quote).not.toContain(FIXTURE_SECRET);
    const report = await runSecuritySuite(
      { version: defaultAttackCorpus().version, cases: defaultAttackCorpus().cases.filter((item) => item.kind === "period-free-secret-dump") },
      async () => ({ kind: "security-runtime" }),
    );
    expect(report.critical).toBe(0);
    expect(report.results[0]?.ok).toBe(true);
  });
});
