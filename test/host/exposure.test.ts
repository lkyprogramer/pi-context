import { describe, expect, it } from "vitest";
import { ExposureLedger, outcomeFromStop } from "../../src/projection/exposure.js";

const snap = {
  generation: 1,
  sessionId: "s",
  leafId: "l",
  sourceRevision: "a".repeat(64),
  modelIdentity: "m",
  configHash: "b".repeat(64),
};

describe("T10 exposure", () => {
  it("does not mark exposure on http 200 stream error, abort, or zero successes", () => {
    const ledger = new ExposureLedger();
    ledger.begin({ attemptId: "1", snapshot: snap, includedOriginalRefs: ["ref-1"], startedAtMs: 0 });
    expect(outcomeFromStop("stop", undefined, "error")).toBe("fail");
    ledger.fail("1");
    expect(ledger.isExposed("ref-1", 1)).toBe(false);
    ledger.begin({ attemptId: "2", snapshot: snap, includedOriginalRefs: ["ref-1"], startedAtMs: 0 });
    ledger.confirm("2", snap, "stop");
    expect(ledger.isExposed("ref-1", 1)).toBe(true);
  });
});
