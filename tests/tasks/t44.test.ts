import { describe, expect, it } from "vitest";

import { createReaderCeiling, type W1ArmCase } from "@pcr/benchmark";

function caseFor(expected: string, extra: Partial<W1ArmCase> = {}): W1ArmCase {
  return {
    caseId: "tool-noise-05",
    clusterId: "tool-noise",
    corpusId: "pcr-bench",
    trace: {
      workspaceId: "ws-t44",
      sessionId: "session-t44",
      entries: [
        { entryId: "u1", role: "user", text: "改为 version 7", workspaceId: "ws-t44", sessionId: "session-t44" },
      ],
    },
    oracle: { items: [{ id: "version-1", key: "version", expected, sourceRefs: ["u1"] }] },
    ...extra,
  };
}

async function runT44Fixture() {
  const ceiling = createReaderCeiling({
    corpusId: "pcr-bench",
    cases: { async get() { return caseFor("7"); } },
  });
  const full = await ceiling.evaluate({ caseId: "tool-noise-05" });
  expect(full).toMatchObject({ answerable: true, fullContextScore: 1 });
  const invented = await createReaderCeiling({
    corpusId: "pcr-bench",
    cases: { async get() { return caseFor("7-tu-00"); } },
  }).evaluate({ caseId: "tool-noise-05" });
  expect(invented).toMatchObject({ answerable: false, fullContextScore: 0 });
  const retained = await ceiling.evaluate({ caseId: "tool-noise-05", candidateText: "keep version 7" });
  expect(retained.candidateRetention).toBe(1);
  const dropped = await ceiling.evaluate({ caseId: "tool-noise-05", candidateText: "no version here" });
  expect(dropped.candidateRetention).toBe(0);
  return { ok: true as const, task: "T44" as const, full, invented };
}

describe("T44 Full-context reader ceiling", () => {
  it("full_context_reader_ceiling", async () => {
    await expect(runT44Fixture()).resolves.toMatchObject({ ok: true, task: "T44" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createReaderCeiling({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_READER_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed evaluate input and missing cases", async () => {
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get() { return null; } },
    });
    await expect(ceiling.evaluate({} as never)).rejects.toMatchObject({ code: "PCR_READER_INPUT_INVALID" });
    await expect(ceiling.evaluate({ caseId: "missing" })).rejects.toMatchObject({ code: "PCR_READER_INPUT_INVALID" });
  });

  it("replays equal ceiling reports for the same case", async () => {
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get() { return caseFor("7"); } },
    });
    const first = await ceiling.evaluate({ caseId: "tool-noise-05" });
    const second = await ceiling.evaluate({ caseId: "tool-noise-05" });
    expect(second).toEqual(first);
  });

  it("rejects a case from another corpus or workspace", async () => {
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: { async get() { return caseFor("7", { corpusId: "other" }); } },
    });
    await expect(ceiling.evaluate({ caseId: "tool-noise-05" })).rejects.toMatchObject({
      code: "PCR_READER_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before loading the case", async () => {
    let loaded = 0;
    const ceiling = createReaderCeiling({
      corpusId: "pcr-bench",
      cases: {
        async get() {
          loaded += 1;
          return caseFor("7");
        },
      },
    });
    await expect(ceiling.evaluate({ caseId: "tool-noise-05", signal: AbortSignal.abort() })).rejects.toThrow();
    expect(loaded).toBe(0);
  });
});
