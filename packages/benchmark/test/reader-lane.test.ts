import { describe, expect, it } from "vitest";

import { createReaderCeiling, type W1ArmCase } from "@pcr/benchmark";

function makeCase(expected: string, text = "改为 version 7"): W1ArmCase {
  return {
    caseId: "temporal-00",
    clusterId: "temporal",
    corpusId: "pcr-bench",
    trace: { entries: [{ entryId: "u1", role: "user", text }] },
    oracle: { items: [{ id: "v", key: "version", expected, sourceRefs: ["u1"] }] },
  };
}

describe("F0 isolated reader lane", () => {
  it("abstains when the full context cannot witness the oracle", async () => {
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get() { return makeCase("7-tu-00"); } },
    });
    const result = await ceiling.evaluate({ caseId: "temporal-00" });
    expect(result.answerable).toBe(false);
    expect(result.fullContextScore).toBe(0);
  });

  it("requires the source witness in F0 before scoring candidate loss", async () => {
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get() { return makeCase("7"); } },
    });
    const full = await ceiling.evaluate({ caseId: "temporal-00" });
    expect(full.answerable).toBe(true);
    const lost = await ceiling.evaluate({ caseId: "temporal-00", candidateText: "no version remains" });
    expect(lost.candidateRetention).toBe(0);
    const kept = await ceiling.evaluate({ caseId: "temporal-00", candidateText: "keep version 7" });
    expect(kept.candidateRetention).toBe(1);
  });
});
