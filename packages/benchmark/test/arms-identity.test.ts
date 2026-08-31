import { describe, expect, it } from "vitest";

import { createW2ArmRunner, type W1ArmCase } from "@pcr/benchmark";
import type { RuntimeCursor } from "@pcr/contracts";

const CURSOR: RuntimeCursor = {
  workspaceId: "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  sessionId: "session-arm",
  leafId: "leaf-arm",
  lineageHash: "c".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

function record(): W1ArmCase {
  return {
    caseId: "tool-noise-05",
    clusterId: "tool-noise",
    corpusId: "pcr-bench",
    trace: {
      entries: [
        { entryId: "u1", role: "user", text: "keep version 7" },
        { entryId: "t1", role: "toolResult", text: "ok" },
      ],
    },
    oracle: { items: [{ id: "v", key: "version", expected: "7", sourceRefs: ["u1"] }] },
  };
}

describe("B0/B1/B2 arm identity", () => {
  it("proves B0 is not from a PCR hook while B1/B2 are, and shares the cut", async () => {
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: {
        benchmarkMajor: 1,
        trainHash: "1".repeat(64),
        devHash: "2".repeat(64),
        lockedTestHash: "4".repeat(64),
        clusters: { "tool-noise": ["tool-noise-05"] },
      },
      cursor: CURSOR,
      cases: { async get() { return record(); } },
      shaper: {
        async shape() {
          return {
            shapedText: "keep version 7",
            sourceSpan: { firstEntryId: "u1", lastEntryId: "t1" },
            retainedTailStartId: "t1",
            tokensBefore: 100,
          };
        },
      },
      native: {
        async compact() {
          return { visibleText: "native keep version 7", tokensAfter: 4, outputHash: "a".repeat(64) };
        },
      },
      pcr: {
        async compact(input) {
          return {
            visibleText: input.materializer === "pcr" ? "materialized keep version 7" : "identity keep version 7",
            tokensAfter: 4,
            outputHash: "b".repeat(64),
          };
        },
      },
    });
    const b0 = await runner.run("tool-noise-05", "B0", 1);
    const b1 = await runner.run("tool-noise-05", "B1", 1);
    const b2 = await runner.run("tool-noise-05", "B2", 1);
    expect(b0.fromHook).toBe(false);
    expect(b1.fromHook).toBe(true);
    expect(b2.fromHook).toBe(true);
    expect(b0.shapedTraceHash).toBe(b1.shapedTraceHash);
    expect(b1.shapedTraceHash).toBe(b2.shapedTraceHash);
    expect(b2.visibleText).not.toMatch(/SIMULATED|\[PCR\]/u);
    expect(b0.compactor).toBe("pi-native");
    expect(b2.materializer).toBe("pcr");
  });
});
