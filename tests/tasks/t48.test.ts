import { describe, expect, it } from "vitest";

import { createPerformanceLaneRunner, type PerformanceLaneSample } from "@pcr/benchmark";

const MODEL = "openclaw/Qwen3.8-27B-WORK";
const ROUTE = {
  modelKey: MODEL,
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;

function cachePort(eligiblePrefixTokens: number, workspaceId = "ws-t48") {
  return {
    async current(scope: { workspaceId: string }) {
      if (scope.workspaceId !== workspaceId) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return { eligiblePrefixTokens };
    },
  };
}

function clonePort(bytes: number, workspaceId = "ws-t48") {
  return {
    async measure(scope: { workspaceId: string }) {
      if (scope.workspaceId !== workspaceId) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return bytes;
    },
  };
}

function sample(overrides: Partial<PerformanceLaneSample> = {}): PerformanceLaneSample {
  return {
    lane: "natural-threshold",
    workspaceId: "ws-t48",
    sessionId: "session-t48",
    modelKey: MODEL,
    tokensBefore: 190_000,
    tokensAfter: 12_000,
    compactReason: "threshold",
    promptTokens: 80_000,
    hookMs: [10, 20, 30, 40],
    ...overrides,
  };
}

function runner() {
  return createPerformanceLaneRunner({
    workspaceId: "ws-t48",
    routes: { [MODEL]: ROUTE },
    cache: cachePort(40_000),
    clone: clonePort(4096),
  });
}

async function runT48Fixture() {
  const lanes = runner();
  const report = await lanes.measure(sample());
  expect(report.hookP50Ms).toBeGreaterThan(0);
  expect(report.hookP95Ms).toBeGreaterThanOrEqual(report.hookP50Ms);
  expect(report.cacheReadTokens).toBe(40_000);
  expect(report.cacheEligibleRatio).toBe(0.5);
  expect(report.cloneBytes).toBe(4096);
  const overflow = await lanes.measure(sample({
    lane: "provider-overflow",
    compactReason: "overflow",
    tokensBefore: 210_000,
  }));
  expect(overflow.cacheReadTokens).toBe(40_000);
  await expect(lanes.measure(sample({
    tokensBefore: 6_200,
    compactReason: "manual" as never,
  }))).rejects.toMatchObject({ code: "PCR_PERFORMANCE_INPUT_INVALID" });
  return { ok: true as const, task: "T48" as const, report };
}

describe("T48 Performance, cache and fault lanes", () => {
  it("performance_cache_and_fault_lanes", async () => {
    await expect(runT48Fixture()).resolves.toMatchObject({ ok: true, task: "T48" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createPerformanceLaneRunner({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_PERFORMANCE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed measure input", async () => {
    await expect(runner().measure({} as never)).rejects.toMatchObject({ code: "PCR_PERFORMANCE_INPUT_INVALID" });
  });

  it("replays equal reports for the same sample", async () => {
    const lanes = runner();
    const first = await lanes.measure(sample());
    const second = await lanes.measure(sample());
    expect(second).toEqual(first);
  });

  it("denies cache reads from another workspace", async () => {
    await expect(runner().measure(sample({ workspaceId: "ws-other" }))).rejects.toMatchObject({
      code: "PCR_PERFORMANCE_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before cache or clone I/O", async () => {
    let cacheReads = 0;
    let cloneReads = 0;
    const lanes = createPerformanceLaneRunner({
      workspaceId: "ws-t48",
      routes: { [MODEL]: ROUTE },
      cache: {
        async current() {
          cacheReads += 1;
          return { eligiblePrefixTokens: 1 };
        },
      },
      clone: {
        async measure() {
          cloneReads += 1;
          return 1;
        },
      },
    });
    await expect(lanes.measure({ ...sample(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(cacheReads).toBe(0);
    expect(cloneReads).toBe(0);
  });
});
