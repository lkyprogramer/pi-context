import { describe, expect, it } from "vitest";

import { summarizeRecovery } from "../../packages/benchmark/src/scoring/recovery.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { runProductionRecoveryFixtures } from "../helpers/production-recovery-fixtures.js";

describe("production hook recovery fixtures", () => {
  it("recovers exact bytes and denies the wrong session or sibling through product tools", async () => {
    try {
      const rows = await runProductionRecoveryFixtures();
      expect(rows).toHaveLength(5);
      expect(rows.map((row) => row.id)).toEqual([
        "protocol-text",
        "protocol-utf8",
        "protocol-image",
        "protocol-append",
        "protocol-restart-model-fence",
      ]);
      const summary = summarizeRecovery(rows);
      expect(summary).toMatchObject({
        eligible: 5,
        attempted: 5,
        passed: 5,
        passRate: 1,
        status: "passed",
      });
    } finally {
      resetOwnerForTest();
    }
  }, 180_000);
});
