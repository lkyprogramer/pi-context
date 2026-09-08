import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { summarize } from "../../eval/local/report.mjs";
import { assertArm } from "../../eval/local/arm-contract.mjs";

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

it("a native arm with a plugin status file is blocked", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pctx-native-"));
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  const verdict = assertArm({ arm: "native" }, { resolvedProfile: "native", hostVersion: "0.85.1" }, agentDir);
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toMatch(/status/);
});
