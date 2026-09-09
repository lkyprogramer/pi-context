import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decide, summarize } from "../../eval/local/report.mjs";
import { assertArm } from "../../eval/local/arm-contract.mjs";
import { parseSession } from "../../eval/local/parse-session.mjs";
import { fileURLToPath } from "node:url";

const req = (input: number | null, cacheRead: number | null) => ({ usage: { input, cacheRead, output: 10, cacheWrite: 0, totalTokens: (input ?? 0) + 10 }, stopReason: "stop", planId: null, replacementsApplied: 0, contextPercentBefore: null, at: "t", sessionId: "s", profile: "balanced" });

it("unknown usage is reported as unknown, never as zero, and pairs are grouped per case and arm", () => {
  const episodes = [
    { manifest: { caseId: "L01", arm: "native", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0), req(1200, 900)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 900, prefillTokensDelta: 1300, requestsDelta: 2, stableRestoresDelta: 1 }, wallMs: 30000 },
    { manifest: { caseId: "L01", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0), req(null, null)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: null, prefillTokensDelta: null, requestsDelta: 2, stableRestoresDelta: 0 }, wallMs: 31000 },
  ];
  const s = summarize(episodes as never);
  const bal = s.byCaseArm["L01"]["balanced"];
  expect(bal.inputSum).toBe(1000);
  expect(bal.unknownUsage).toBe(1);
  expect(bal.engine.prefixHitRatio).toBeNull();
  expect(s.byCaseArm["L01"]["native"].engine.prefixHitRatio).toBeCloseTo(900 / 2200, 3);
});

it("an observe episode whose plugin resolved to a different profile is blocked", () => {
  const verdict = assertArm({ arm: "observe", configHash: "abc" }, { resolvedProfile: "balanced", configHash: "abc", hostVersion: "0.85.1" }, "/tmp/agentdir-with-extensions");
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toMatch(/profile/);
});

it("observe is not blocked when its configHash differs from a previously frozen balanced hash", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pctx-obs-"));
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["/plugin/extension.js"] }));
  const sameArm = assertArm(
    { arm: "observe", configHash: "obs-hash" },
    { resolvedProfile: "observe", configHash: "obs-hash", hostVersion: "0.85.1" },
    agentDir,
  );
  const crossed = assertArm(
    { arm: "observe", configHash: "bal-hash" },
    { resolvedProfile: "observe", configHash: "obs-hash", hostVersion: "0.85.1" },
    agentDir,
  );
  expect(sameArm.ok).toBe(true);
  expect(crossed.ok).toBe(false);
  expect(crossed.reason).toMatch(/configHash/);
});

it("an observe arm loaded via additionalExtensionPaths is ok when status matches even if settings.extensions is empty", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pctx-host-"));
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  const verdict = assertArm(
    { arm: "observe", configHash: "obs-hash" },
    { resolvedProfile: "observe", configHash: "obs-hash", hostVersion: "0.85.1" },
    agentDir,
  );
  expect(verdict.ok).toBe(true);
});

const scenarios = { qualityIds: ["L01"], capabilityIds: ["H01", "H02", "H03"] };

function hEpisode(rep: number, mech: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    manifest: { caseId: "H01", arm: "balanced", rep },
    status: "complete",
    oracle: { passed: true, nonceCorrect: true },
    requests: [
      req(1000, 0),
      req(800, 100),
      req(900, 600),
      req(900, 700),
    ],
    mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 1, historySearches: 0, verifiedReads: 1, foldedErrorResults: 0, ...mech },
    foldEvents: [{ at: "t0", savedTokensEstimate: 100, invalidatedTokensEstimate: 200, addedEntryIds: ["r1"] }],
    engine: { prefixHitTokensDelta: null, prefillTokensDelta: null, requestsDelta: 4 },
    wallMs: 1000,
    ...extra,
  };
}

it("decide counts folds per episode and requires verifiedReads on the same H01 episode", () => {
  const oneFold = [
    { ...hEpisode(1, { folds: 1, verifiedReads: 1 }), requests: [req(1000, 0), req(800, 50), req(900, 600), req(900, 700)] },
    { ...hEpisode(2, { folds: 0, verifiedReads: 0, historyReads: 0 }), oracle: { passed: true, nonceCorrect: true } },
    { manifest: { caseId: "H02", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "H02", arm: "balanced", rep: 2 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "native", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
  ];
  const summary = summarize(oneFold as never);
  const decision = decide(summary, scenarios, oneFold as never);
  expect(decision.gate).toBe("mechanism");
  expect(decision.reasons.some((r) => r.includes("2/4"))).toBe(true);
});

it("H01 does not pass when one episode answers and a different episode has verifiedReads", () => {
  const split = [
    { ...hEpisode(1, { folds: 1, verifiedReads: 0, historyReads: 0 }), oracle: { passed: true, nonceCorrect: true } },
    { ...hEpisode(2, { folds: 1, verifiedReads: 1 }), oracle: { passed: false, nonceCorrect: false } },
    { manifest: { caseId: "H02", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 500)], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "H02", arm: "balanced", rep: 2 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 500)], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "native", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
  ];
  const decision = decide(summarize(split as never), scenarios, split as never);
  expect(decision.gate).toBe("mechanism");
  expect(decision.reasons.join(" ")).toMatch(/verified read/);
});

it("H02 folding an isError result fails the mechanism gate", () => {
  const eps = [
    hEpisode(1, { folds: 1, verifiedReads: 1 }),
    { ...hEpisode(2, { folds: 1, verifiedReads: 1 }), manifest: { caseId: "H01", arm: "balanced", rep: 2 } },
    { manifest: { caseId: "H02", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0), req(800, 50), req(900, 600), req(900, 700)], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 1 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "H02", arm: "balanced", rep: 2 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0), req(800, 50), req(900, 600), req(900, 700)], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "native", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
  ];
  const decision = decide(summarize(eps as never), scenarios, eps as never);
  expect(decision.gate).toBe("mechanism");
  expect(decision.reasons.join(" ")).toMatch(/isError/);
});

it("cost gate requires two recovering requests after the fold, not one", () => {
  const at = (n: number, input: number, cacheRead: number) => ({
    at: `2026-01-01T00:00:0${n}Z`,
    usage: { input, cacheRead, output: 1, cacheWrite: 0, totalTokens: input + 1 },
    stopReason: "stop",
    replacementsApplied: n === 2 ? 1 : 0,
  });
  const eps = [
    { ...hEpisode(1, { folds: 1, verifiedReads: 1 }), foldEvents: [{ at: "2026-01-01T00:00:02Z", savedTokensEstimate: 10, invalidatedTokensEstimate: 10, addedEntryIds: ["r1"] }], requests: [at(1, 1000, 900), at(2, 800, 0), at(3, 900, 100), at(4, 900, 200)] },
    { ...hEpisode(2, { folds: 1, verifiedReads: 1 }), manifest: { caseId: "H01", arm: "balanced", rep: 2 }, foldEvents: [{ at: "2026-01-01T00:00:02Z", savedTokensEstimate: 10, invalidatedTokensEstimate: 10, addedEntryIds: ["r1"] }], requests: [at(1, 1000, 900), at(2, 800, 0), at(3, 900, 600), at(4, 900, 700)] },
    { manifest: { caseId: "H02", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [at(1, 1000, 900), at(2, 800, 0), at(3, 900, 600), at(4, 900, 700)], foldEvents: [{ at: "2026-01-01T00:00:02Z", savedTokensEstimate: 10, invalidatedTokensEstimate: 10 }], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "H02", arm: "balanced", rep: 2 }, status: "complete", oracle: { passed: true }, requests: [at(1, 1000, 900), at(2, 800, 0), at(3, 900, 600), at(4, 900, 700)], foldEvents: [{ at: "2026-01-01T00:00:02Z", savedTokensEstimate: 10, invalidatedTokensEstimate: 10 }], mechanism: { folds: 1, replacements: 1, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0 }, engine: {}, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "native", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
    { manifest: { caseId: "L01", arm: "balanced", rep: 1 }, status: "complete", oracle: { passed: true }, requests: [req(1000, 0)], mechanism: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHitTokensDelta: 1, prefillTokensDelta: 1 }, wallMs: 1 },
  ];
  const decision = decide(summarize(eps as never), scenarios, eps as never);
  expect(decision.gate).toBe("cost");
  expect(decision.reasons.join(" ")).toMatch(/within 2 requests/);
});

it("parse-session counts verifiedReads from pctx_history metadata, not from a missing status field", () => {
  const parsed = parseSession(fileURLToPath(new URL("../fixtures/local-eval/sample-session.jsonl", import.meta.url)));
  expect(parsed.verifiedReads).toBe(1);
  expect(parsed.historyReads).toBe(1);
});

it("a native arm with a plugin status file is blocked", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pctx-native-"));
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  const verdict = assertArm({ arm: "native" }, { resolvedProfile: "native", hostVersion: "0.85.1" }, agentDir);
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toMatch(/status/);
});
