import { describe, expect, it } from "vitest";
import { fuzzRecoveryHashMismatch } from "./support.js";

describe("recovery fuzz", () => {
  it("quarantines a host journal whose content hash no longer matches the prepared saga", async () => {
    await expect(fuzzRecoveryHashMismatch()).resolves.toBe("quarantined");
  });
});
