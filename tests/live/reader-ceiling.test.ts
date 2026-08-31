import { describe, expect, it } from "vitest";

import { createReaderCeiling, type W1ArmCase } from "@pcr/benchmark";

describe("reader ceiling live decomposition", () => {
  it("separates invented oracle values from compressor drop", async () => {
    const record: W1ArmCase = {
      caseId: "temporal-05",
      clusterId: "temporal",
      corpusId: "pcr-bench",
      trace: {
        entries: [
          { entryId: "u1", role: "user", text: "改为 version 7" },
          { entryId: "t1", role: "toolResult", text: "error: boom\nexit code 1" },
        ],
      },
      oracle: {
        items: [
          { id: "version-1", key: "version", expected: "7", sourceRefs: ["u1"] },
          { id: "error-1", key: "error", expected: "error: boom", sourceRefs: ["t1"] },
        ],
      },
    };
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get(caseId) { return caseId === record.caseId ? record : null; } },
    });
    const full = await ceiling.evaluate({ caseId: record.caseId });
    expect(full).toEqual({ answerable: true, fullContextScore: 1 });
    const compacted = await ceiling.evaluate({
      caseId: record.caseId,
      candidateText: "keep version 7; ignore the log",
    });
    expect(compacted.answerable).toBe(true);
    expect(compacted.candidateRetention).toBe(0.5);
    const invented = await createReaderCeiling({
      corpusId: "pcr-bench",
      cases: {
        async get() {
          return { ...record, oracle: { items: [{ id: "bad", key: "version", expected: "7-tu-00" }] } };
        },
      },
    }).evaluate({ caseId: record.caseId, candidateText: "keep version 7" });
    expect(invented).toMatchObject({ answerable: false, fullContextScore: 0, candidateRetention: 0 });
  });
});
