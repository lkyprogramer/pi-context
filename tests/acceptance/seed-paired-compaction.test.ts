import { afterEach, describe, expect, it } from "vitest";

import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { assertSessionToolPairs, inspectSessionCompaction } from "../../packages/benchmark/src/small-live.js";
import { createProductHarness } from "../helpers/product-harness.js";

afterEach(resetOwnerForTest);

describe("product-path live seed compaction", () => {
  it("produces paired tool history and a fromHook compaction entry", async () => {
    const harness = await createProductHarness();
    try {
      const payload = `${"prefix\n".repeat(80)}observed token=alpha-ancestor-token-7f3c2e\n${"suffix\n".repeat(80)}`;
      harness.scriptToolResult("seed_obs", {
        content: [{ type: "text", text: payload }],
      });
      await harness.runToolTurn("seed_obs", { sourceEntryId: "t1" });
      assertSessionToolPairs(harness.manager.getSessionFile());
      for (let i = 0; i < 5; i += 1) {
        await harness.prompt(`Work log ${i}. Never deploy production. ${"Observed local build output. ".repeat(160)}`);
      }
      harness.setResponse("pressure");
      await harness.prompt("Use the earlier tool observation.");
      const sessionFile = harness.manager.getSessionFile();
      const inspected = inspectSessionCompaction(sessionFile);
      expect(inspected.count).toBeGreaterThan(0);
      expect(inspected.fromHook).toBe(true);
    } finally {
      await harness.close();
    }
  }, 120_000);
});
