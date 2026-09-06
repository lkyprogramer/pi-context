import { afterEach, describe, expect, it } from "vitest";

import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { createProductHarness } from "../helpers/product-harness.js";

afterEach(resetOwnerForTest);

describe("active tool batches", () => {
  it("keeps two distinct same-output tool calls in the next provider request", async () => {
    const harness = await createProductHarness();
    try {
      harness.scriptToolResult("batch_alpha", {
        content: [{ type: "text", text: "OK" }],
        isError: false,
      });
      await harness.runToolTurn("batch_alpha", { n: 1 });
      harness.scriptToolResult("batch_beta", {
        content: [{ type: "text", text: "OK" }],
        isError: false,
      });
      await harness.runToolTurn("batch_beta", { n: 2 });
      await harness.prompt("Use both previous tool results.");
      const seen = JSON.stringify(harness.requests());
      expect(seen).toContain("batch_alpha");
      expect(seen).toContain("batch_beta");
      const okCount = seen.split("\"OK\"").length - 1;
      expect(okCount).toBeGreaterThanOrEqual(2);
    } finally {
      await harness.close();
    }
  });
});
