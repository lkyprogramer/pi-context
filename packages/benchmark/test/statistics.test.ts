import { describe, expect, it } from "vitest";

import {
  createClusterStatistics,
} from "@pcr/benchmark";
import type { ITTArmResult } from "../src/statistics/cluster.js";
import { withTransportRetry } from "../../../tests/live-gate/rpc-client.js";

describe("cluster statistics", () => {
  it("weights clusters equally instead of parameterized clones", async () => {
    const stats = createClusterStatistics({
      catalog: {
        corpusId: "pcr-bench",
        clusters: {
          temporal: ["t0", "t1", "t2", "t3"],
          negation: ["n0"],
        },
      },
    });
    const result = await stats.bootstrap({
      corpusId: "pcr-bench",
      seed: 3,
      draws: 16,
      pairs: [
        { caseId: "t0", baseline: 0, candidate: 0 },
        { caseId: "t1", baseline: 0, candidate: 0 },
        { caseId: "t2", baseline: 0, candidate: 0 },
        { caseId: "t3", baseline: 0, candidate: 0 },
        { caseId: "n0", baseline: 0, candidate: 1 },
      ],
    });
    expect(result.estimate).toBe(0.5);
    expect(result.clusters).toBe(2);
    expect(result.pairs).toBe(5);
  });

  it("keeps planned denominator and counts exhausted timeout as ITT failure", () => {
    const arm = (status: ITTArmResult["status"], value?: number, retried = false): ITTArmResult => ({
      status,
      value,
      retried,
    });
    const stats = createClusterStatistics({
      catalog: {
        corpusId: "pcr-bench",
        clusters: { all: ["a", "b", "c"] },
      },
    });
    const result = stats.itt({
      corpusId: "pcr-bench",
      planned: 3,
      pairs: [
        { caseId: "a", baseline: arm("completed", 1), candidate: arm("completed", 1) },
        { caseId: "b", baseline: arm("timeout", undefined, true), candidate: arm("completed", 1) },
        { caseId: "c", baseline: arm("missing"), candidate: arm("completed", 1) },
      ],
    });
    expect(result).toMatchObject({ planned: 3, attempted: 3, completed: 1, scored: 1, failed: 2, retried: 1 });
    expect(result.itt).toEqual({ baseline: 1 / 3, candidate: 2 / 3 });
    expect(result.completeCase).toEqual({ baseline: 1, candidate: 1, pairs: 1 });
  });

  it("does not retry non-transport failures and caps transport retries at two", async () => {
    const attempts: number[] = [];
    const exhausted = await withTransportRetry(
      async (attempt) => {
        attempts.push(attempt);
        throw Object.assign(new Error("transport disconnected"), { code: "ECONNRESET" });
      },
      { maxRetries: 2 },
    );
    expect(exhausted).toMatchObject({ ok: false, exhausted: true, attempts: 3, retried: true });
    expect(attempts).toEqual([1, 2, 3]);

    const product = await withTransportRetry(
      async () => {
        throw new Error("prompt did not settle");
      },
      { maxRetries: 2 },
    );
    expect(product).toMatchObject({ ok: false, exhausted: true, attempts: 1, retried: false });
  });
});
