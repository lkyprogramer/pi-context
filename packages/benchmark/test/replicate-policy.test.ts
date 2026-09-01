import { describe, expect, it } from "vitest";

import {
  DEFAULT_ARM_CONCURRENCY,
  assertSerialArms,
  assertSeparateCacheLanes,
  bindReplicate,
  latinSquareOrder,
  partitionCacheLanes,
  recordSchedule,
  rejectLabelOnlySeed,
} from "@pcr/benchmark";

describe("controlled replicate policy", () => {
  it("rejects a seed that only changes a loop label", () => {
    expect(() => rejectLabelOnlySeed({ seed: 1, label: "s1" })).toThrowError(
      expect.objectContaining({ code: "PCR_REPLICATE_LABEL_ONLY" }),
    );
    expect(() => bindReplicate({
      seed: 2,
      workspaceId: "ws-a",
      sessionId: "sess-a",
      providerSupportsSeed: true,
    })).toThrowError(expect.objectContaining({ code: "PCR_REPLICATE_LABEL_ONLY" }));
  });

  it("binds seed into workspace, session, and sampling or reports replicate-repeat", () => {
    const sampled = bindReplicate({
      seed: 3,
      workspaceId: "ws-bound",
      sessionId: "sess-bound",
      providerSupportsSeed: true,
      sampling: { seed: 3, temperature: 0 },
    });
    expect(sampled.seedMode).toBe("provider-sampling");
    expect(sampled.sampling).toEqual({ seed: 3, temperature: 0 });
    const repeated = bindReplicate({
      seed: 3,
      workspaceId: "ws-bound",
      sessionId: "sess-bound",
      providerSupportsSeed: false,
    });
    expect(repeated.seedMode).toBe("replicate-repeat");
    expect(repeated.sampling).toEqual({ seedUnsupported: true, replicateIndex: 3 });
    expect(() => rejectLabelOnlySeed({
      seed: 3,
      workspaceId: "ws-bound",
      sessionId: "sess-bound",
      sampling: { seed: 3 },
    })).not.toThrow();
  });

  it("schedules arms as a latin square and refuses concurrent arms", () => {
    expect(DEFAULT_ARM_CONCURRENCY).toBe(1);
    expect(latinSquareOrder(["B0", "B1", "B2", "F0"], 0)).toEqual(["B0", "B1", "B2", "F0"]);
    expect(latinSquareOrder(["B0", "B1", "B2", "F0"], 1)).toEqual(["B1", "B2", "F0", "B0"]);
    expect(() => assertSerialArms(2)).toThrowError(expect.objectContaining({ code: "PCR_REPLICATE_CONCURRENT_ARMS" }));
    assertSerialArms(1);
  });

  it("keeps cold and hot cache lanes apart and records rate-limit delay", () => {
    const split = partitionCacheLanes([
      { cacheLane: "cold" as const, requestId: "c1" },
      { cacheLane: "hot" as const, requestId: "h1" },
    ]);
    expect(split.cold).toHaveLength(1);
    expect(split.hot).toHaveLength(1);
    expect(() => assertSeparateCacheLanes([{ requestId: "same" }], [{ requestId: "same" }])).toThrowError(
      expect.objectContaining({ code: "PCR_REPLICATE_CACHE_LANE_MIXED" }),
    );
    const schedule = recordSchedule([
      {
        arm: "B0",
        seed: 0,
        enqueuedAt: 0,
        startedAt: 10,
        endedAt: 20,
        rateLimited: true,
        rateLimitDelayMs: 5,
      },
      {
        arm: "B1",
        seed: 0,
        enqueuedAt: 12,
        startedAt: 21,
        endedAt: 30,
        rateLimited: false,
        rateLimitDelayMs: 0,
      },
    ]);
    expect(schedule.serial).toBe(true);
    expect(schedule.rateLimited).toBe(1);
    expect(() => recordSchedule([
      {
        arm: "B0",
        seed: 0,
        enqueuedAt: 0,
        startedAt: 10,
        endedAt: 25,
        rateLimited: false,
        rateLimitDelayMs: 0,
      },
      {
        arm: "B1",
        seed: 0,
        enqueuedAt: 0,
        startedAt: 20,
        endedAt: 30,
        rateLimited: false,
        rateLimitDelayMs: 0,
      },
    ])).toThrowError(expect.objectContaining({ code: "PCR_REPLICATE_SCHEDULE_OVERLAP" }));
  });
});
