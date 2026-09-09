import { expect, test } from "vitest";
import {
  aggregateAttempts,
  evaluateTrial,
  median,
  normalizeUsage,
  pairedSuccessDelta,
} from "../../eval/local/accounting.mjs";

const req = (id: string, n: number) => ({
  requestId: id,
  source: "pi-disjoint",
  usage: { input: n, cacheRead: 0, cacheWrite: 0, output: 1 },
});

const pair = (extra: Record<string, unknown> = {}) => ({
  caseId: "q",
  rep: 0,
  nativePassed: true,
  candidatePassed: true,
  foldRequired: true,
  foldApplied: true,
  criticalViolation: false,
  evidencePassed: true,
  ...extra,
});

const objective = (known = true, change = -0.2) => ({
  metric: "logical-input",
  known,
  relativeChange: change,
  minImprovement: 0.1,
});

test("Pi already separated cache from input", () => {
  const u = normalizeUsage({ input: 100, cacheRead: 60, cacheWrite: 0, output: 1 }, "pi-disjoint");
  expect(u.logicalInput).toBe(160);
  expect(u.freshInput).toBe(100);
  expect(u.cacheRatio).toBeCloseTo(0.375);
  expect(median([10, 100])).toBe(55);
});

test("failed attempt usage is not erased", () => {
  const attempt = (id: string, status: string, input: number) => ({
    episodeId: "e",
    attemptId: id,
    status,
    requests: [{ requestId: `${id}-q`, source: "pi-disjoint", usage: { input, cacheRead: 0, cacheWrite: 0, output: 1 } }],
  });
  const r = aggregateAttempts([attempt("a1", "timeout", 1000), attempt("a2", "passed", 10)]);
  expect(r.episodes.e.attemptCount).toBe(2);
  expect(r.episodes.e.logicalInput).toBe(1010);
  expect(r.episodes.e.firstStatus).toBe("timeout");
});

test("cached greater than fresh is valid on Pi disjoint", () => {
  const u = normalizeUsage({ input: 40, cacheRead: 60, cacheWrite: 0, output: 1 }, "pi-disjoint");
  expect(u.complete).toBe(true);
  expect(u.cacheRatio).toBe(0.6);
});

test("raw inclusive prompt/cache maps to fresh 40", () => {
  const u = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 4,
    prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 0 },
  }, "raw-openai-inclusive");
  expect(u.freshInput).toBe(40);
  expect(u.logicalInput).toBe(100);
});

test("raw prompt 10 / cacheRead 20 is invalid not clamped", () => {
  const u = normalizeUsage({
    prompt_tokens: 10,
    completion_tokens: 1,
    prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
  }, "raw-openai-inclusive");
  expect(u.complete).toBe(false);
  expect(u.logicalInput).toBeNull();
  expect(u.error).toBe("invalid-inclusive-buckets");
});

test("missing cacheWrite is not a valid zero", () => {
  const u = normalizeUsage({ input: 1, output: 1 }, "pi-disjoint");
  expect(u.logicalInput).toBeNull();
  expect(u.error).toBe("partial-usage");
});

test("reasoning tokens are already inside output", () => {
  const u = normalizeUsage({ input: 1, cacheRead: 0, cacheWrite: 0, output: 4, reasoning: 3 }, "pi-disjoint");
  expect(u.output).toBe(4);
});

test("median of empty is null", () => {
  expect(median([])).toBeNull();
});

test("missing retry usage makes episode total unknown", () => {
  const r = aggregateAttempts([
    { episodeId: "e", attemptId: "a", status: "timeout", requests: [{ requestId: "q", source: "pi-disjoint", usage: null }] },
    { episodeId: "e", attemptId: "b", status: "passed", requests: [req("q2", 10)] },
  ]);
  expect(r.episodes.e.logicalInput).toBeNull();
  expect(r.episodes.e.knownLogicalSubtotal).toBe(10);
});

test("duplicate observation of the same requestId counts once", () => {
  const r = aggregateAttempts([{
    episodeId: "e",
    attemptId: "a",
    status: "passed",
    requests: [req("q", 10), req("q", 10)],
  }]);
  expect(r.episodes.e.logicalInput).toBe(10);
});

test("same requestId with different usage is a conflict", () => {
  expect(() => aggregateAttempts([{
    episodeId: "e",
    attemptId: "a",
    status: "passed",
    requests: [req("q", 10), req("q", 20)],
  }])).toThrow(/conflicting-request-id/);
});

test("two same-content requests with distinct ids each count", () => {
  const r = aggregateAttempts([{
    episodeId: "e",
    attemptId: "a",
    status: "passed",
    requests: [req("q1", 10), req("q2", 10)],
  }]);
  expect(r.episodes.e.logicalInput).toBe(20);
  expect(r.episodes.e.requestCount).toBe(2);
});

test("paired success delta is a mean", () => {
  const pairs = Array.from({ length: 12 }, () => pair());
  for (const p of pairs.filter((_, i) => i % 2 === 0)) p.candidatePassed = false;
  expect(pairedSuccessDelta(pairs)).toBe(-0.5);
});

test("trial decisions match the reference cases", () => {
  const pairs = Array.from({ length: 12 }, () => pair());
  for (const p of pairs.filter((_, i) => i % 2 === 0)) p.candidatePassed = false;
  expect(evaluateTrial(pairs, [{ eligible: true, passed: true }], objective(true, 0.4)).decision).toBe("review-needed");
  expect(evaluateTrial([pair({ foldApplied: false })], [], objective()).decision).toBe("inconclusive");
  expect(evaluateTrial([pair({ evidencePassed: false })], [], objective()).decision).toBe("review-needed");
  expect(evaluateTrial([pair()], [{ eligible: true, passed: true }], objective(true, 0.08)).decision).toBe("history-only");
  expect(evaluateTrial([pair()], [{ eligible: true, passed: true }], objective(false)).decision).toBe("quality-qualified-cost-unknown");
  expect(evaluateTrial([pair()], [{ eligible: true, passed: true }], objective()).decision).toBe("limited-balanced-trial");
  expect(evaluateTrial([pair()], [], objective(), 2).decision).toBe("inconclusive");
  expect(evaluateTrial([pair()], [], objective()).decision).toBe("inconclusive");
});
