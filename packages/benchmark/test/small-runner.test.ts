import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  SmallRunnerError,
  appendResults,
  assertResumeIdentity,
  attemptFromScore,
  decideCanary,
  executePlannedPair,
  hashSourceSet,
  planPrimaryPairs,
  preflightSmallRun,
  primaryArmOrder,
  recordedMonetaryCost,
  resumeGuard,
  scoreRecordedAnswer,
  summarizeAttempts,
  validateScenario,
  verifySmallRun,
  type ArmExecutor,
  type PairAttempts,
  type RunIdentity,
  type Scenario,
} from "../src/small-runner.js";

const SOURCE_TEXT = "改为 version 7；还没有执行修改。";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readerScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "s1",
    clusterId: "c1",
    provenance: "synthetic",
    mode: "reader",
    prompt: "目标版本号是什么？",
    sourceEntries: [{ id: "u2", role: "user", text: SOURCE_TEXT }],
    oracle: {
      kind: "requested-target",
      expected: "7",
      sourceEntryId: "u2",
      sourceSha256: sha(SOURCE_TEXT),
    },
    workspaceFiles: {},
    assertions: [],
    ...overrides,
  };
}

function identity(overrides: Partial<RunIdentity> = {}): RunIdentity {
  return {
    sourceSetSha256: "aa".repeat(32),
    hostPatchSha256: "bb".repeat(32),
    modelFingerprint: "openclaw/Qwen3.8-27B-WORK",
    corpusSha256: "cc".repeat(32),
    configSha256: "dd".repeat(32),
    scorerRevision: "lean-v4-t07-probe",
    ...overrides,
  };
}

it("does not discard a product pair because a diagnostic arm failed", () => {
  const rows = [{
    id: "s1",
    clusterId: "c1",
    repeat: 0,
    B0: { status: "completed", success: true },
    B2: { status: "completed", success: true },
    B1: { status: "timeout", success: false },
  }] as const;
  const out = summarizeAttempts(rows);
  expect(out.primaryCompletePairs).toBe(1);
  expect(out.plannedPairs).toBe(1);
  expect(out.diagnosticFailures).toBe(1);
});

it("keeps timeouts inside the ITT denominator", () => {
  const rows: PairAttempts[] = [
    {
      id: "s1",
      clusterId: "c1",
      repeat: 0,
      B0: { status: "timeout", success: false },
      B2: { status: "completed", success: true },
    },
    {
      id: "s2",
      clusterId: "c2",
      repeat: 0,
      B0: { status: "completed", success: true },
      B2: { status: "completed", success: true },
    },
  ];
  const out = summarizeAttempts(rows);
  expect(out.ittPairs).toBe(2);
  expect(out.primaryCompletePairs).toBe(1);
  expect(out.plannedPairs).toBe(2);
});

it("rejects duplicate pair ids", () => {
  expect(() => summarizeAttempts([
    { id: "s1", clusterId: "c1", repeat: 0, B0: { status: "completed", success: true }, B2: { status: "completed", success: true } },
    { id: "s1", clusterId: "c1", repeat: 0, B0: { status: "completed", success: false }, B2: { status: "completed", success: false } },
  ])).toThrowError(expect.objectContaining({ code: "PCR_SMALL_RUNNER_DUPLICATE_PAIR" }));
});

it("forbids resume when run identity drifts", () => {
  expect(() => assertResumeIdentity(identity(), identity({ scorerRevision: "changed" }))).toThrowError(
    expect.objectContaining({ code: "PCR_SMALL_RUNNER_RESUME_MISMATCH", details: expect.objectContaining({ field: "scorerRevision" }) }),
  );
});

it("keeps unknown monetary cost as null instead of zero", () => {
  expect(recordedMonetaryCost(null)).toBeNull();
  expect(recordedMonetaryCost(undefined)).toBeNull();
  expect(recordedMonetaryCost(1.25)).toBe(1.25);
});

it("does not treat an empty answer as success", () => {
  const score = scoreRecordedAnswer({ expected: "7", family: "version", fullAnswer: "" });
  expect(score.ok).toBe(false);
  expect(attemptFromScore("completed", score, "").success).toBe(false);
});

it("does not score a 400-character preview as the full answer", () => {
  const preview = `{"answer":"7","kind":"requested-target"}`.padEnd(400, " ");
  const previewOnly = scoreRecordedAnswer({ expected: "7", family: "version", fullAnswer: preview, preview });
  expect(previewOnly.ok).toBe(false);
  expect(previewOnly.bucket).toBe("unscorable");
  const full = scoreRecordedAnswer({
    expected: "7",
    family: "version",
    preview,
    fullAnswer: `${preview}\nmore`,
  });
  expect(full.ok).toBe(true);
});

it("does not adopt on short checkpoints with untested recovery", () => {
  expect(decideCanary({
    integrityFailures: 0,
    recoveryTested: 0,
    recoveryPassed: 0,
    criticalRegressions: 0,
    completedPairs: 24,
    plannedPairs: 24,
    medianTaskInputDelta: -0.50,
    medianWallTimeDelta: -0.30,
  })).toBe("inconclusive");
});

it("keeps native when efficiency is unknown rather than treating missing deltas as zero savings", () => {
  expect(decideCanary({
    integrityFailures: 0,
    recoveryTested: 5,
    recoveryPassed: 5,
    criticalRegressions: 0,
    completedPairs: 12,
    plannedPairs: 12,
    medianTaskInputDelta: null,
    medianWallTimeDelta: null,
  })).toBe("keep-native");
});

it("rejects canary when a known efficiency regresses more than 10%", () => {
  expect(decideCanary({
    integrityFailures: 0,
    recoveryTested: 5,
    recoveryPassed: 5,
    criticalRegressions: 0,
    completedPairs: 12,
    plannedPairs: 12,
    medianTaskInputDelta: -0.20,
    medianWallTimeDelta: 0.11,
  })).toBe("keep-native");
});

it("hashes real source files rather than a wrapper digest", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcr-source-set-"));
  const runner = join(dir, "small-runner.ts");
  const lock = join(dir, "pnpm-lock.yaml");
  const wrapper = join(dir, "extension.js");
  writeFileSync(wrapper, "export default 1;\n");
  writeFileSync(lock, "lockfileVersion: 9.0\n");
  writeFileSync(runner, "export function summarizeAttempts() {}\n");
  const first = hashSourceSet([runner, lock, wrapper]);
  writeFileSync(runner, "export function summarizeAttempts() { return 1; }\n");
  const second = hashSourceSet([runner, lock, wrapper]);
  expect(first).not.toBe(second);
  expect(first).not.toBe(sha(readFileSync(wrapper, "utf8")));
});

it("binds oracle sourceSha256 to the cited entry text", () => {
  expect(() => validateScenario(readerScenario({
    oracle: { kind: "requested-target", expected: "7", sourceEntryId: "u2", sourceSha256: sha("other") },
  }))).toThrowError(expect.objectContaining({ code: "PCR_SMALL_RUNNER_INPUT_INVALID" }));
  expect(validateScenario(readerScenario()).oracle.expected).toBe("7");
});

it("alternates primary arm order across repeats", () => {
  expect(primaryArmOrder(0)).toEqual(["B0", "B2"]);
  expect(primaryArmOrder(1)).toEqual(["B2", "B0"]);
  const planned = planPrimaryPairs({ scenarios: [{ id: "s1", clusterId: "c1" }], repeats: 2 });
  expect(planned.map((row) => row.order)).toEqual([["B0", "B2"], ["B2", "B0"]]);
});

it("preflight does not enable live requests without PCR_LIVE", () => {
  const dir = mkdtempSync(join(tmpdir(), "pcr-preflight-"));
  const patch = join(dir, "patches");
  mkdirSync(patch, { recursive: true });
  const patchFile = join(patch, "@earendil-works__pi-coding-agent@0.84.4.patch");
  writeFileSync(patchFile, "diff --git a/x b/x\n");
  const source = join(dir, "runner.ts");
  writeFileSync(source, "export {}\n");
  const configPath = join(dir, "canary.json");
  writeFileSync(configPath, JSON.stringify({
    liveEnabled: false,
    requireToolCredentialIsolation: true,
    providerModel: "openclaw/Qwen3.8-27B-WORK",
    contextWindow: 200192,
    repeats: 2,
    independentTasksRequired: 12,
    scenarioFiles: [],
    host: { patchSha256: sha(readFileSync(patchFile, "utf8")) },
  }));
  const report = preflightSmallRun({
    configPath,
    cwd: dir,
    env: { PCR_LIVE: "0" },
    sourcePaths: ["runner.ts"],
  });
  expect(report.liveEnabled).toBe(false);
  expect(report.identity.hostPatchSha256).toBe(sha(readFileSync(patchFile, "utf8")));
  expect(report.identity.sourceSetSha256).toBe(hashSourceSet([source]));
});

it("runs isolated primary homes in planned order without sharing cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "pcr-small-arm-"));
  const seedWorkspaceDir = join(root, "seed");
  mkdirSync(seedWorkspaceDir);
  writeFileSync(join(seedWorkspaceDir, "shared.txt"), "same-input\n");
  const seedSessionFile = join(root, "seed.jsonl");
  writeFileSync(seedSessionFile, `${JSON.stringify({ type: "session", id: "sess", cwd: seedWorkspaceDir })}\n`);
  const seen: string[] = [];
  const executor: ArmExecutor = {
    async run({ arm, home }) {
      seen.push(`${arm}:${home.cwd}`);
      writeFileSync(join(home.cwd, `${arm}.txt`), arm);
      return {
        status: "completed",
        fullAnswer: "{\"answer\":\"7\",\"kind\":\"requested-target\"}",
        preview: "{\"answer\":\"7\"}",
        stopReason: "end_turn",
        usage: [{ requestId: "r1", input: 10, cacheRead: null, cacheWrite: null, output: 4, elapsedMs: 12 }],
        toolCalls: [],
        cacheState: "cold",
        monetaryCost: null,
        wallTimeMs: 12,
      };
    },
  };
  const scenario = readerScenario();
  const planned = planPrimaryPairs({ scenarios: [scenario], repeats: 2 })[1]!;
  const executed = await executePlannedPair({
    scenario,
    planned,
    root: join(root, "pair"),
    seedSessionFile,
    seedWorkspaceDir,
    executor,
  });
  expect(planned.order).toEqual(["B2", "B0"]);
  expect(seen.map((row) => row.slice(0, 2))).toEqual(["B2", "B0"]);
  expect(executed.homes[0]?.cwd).not.toBe(executed.homes[1]?.cwd);
  expect(readFileSync(join(executed.homes.find((home) => home.arm === "B0")!.cwd, "B0.txt"), "utf8")).toBe("B0");
  expect(executed.pair.B0.success).toBe(true);
  expect(executed.pair.B2.success).toBe(true);
});

it("verifySmallRun keeps diagnostic failures out of the primary complete count", () => {
  const run = {
    identity: identity(),
    plannedPairs: 1,
    liveEnabled: false,
    status: "complete" as const,
    monetaryCost: null,
  };
  const results = [
    {
      pairId: "s1",
      clusterId: "c1",
      repeat: 0,
      arm: "B0" as const,
      attempt: { status: "completed" as const, success: true },
      fullAnswer: "7",
      preview: "7",
      stopReason: "end_turn",
      usage: [],
      monetaryCost: null,
      cacheState: "cold" as const,
      wallTimeMs: 1,
    },
    {
      pairId: "s1",
      clusterId: "c1",
      repeat: 0,
      arm: "B2" as const,
      attempt: { status: "completed" as const, success: true },
      fullAnswer: "7",
      preview: "7",
      stopReason: "end_turn",
      usage: [],
      monetaryCost: null,
      cacheState: "cold" as const,
      wallTimeMs: 1,
    },
    {
      pairId: "s1",
      clusterId: "c1",
      repeat: 0,
      arm: "B1" as const,
      attempt: { status: "failed" as const, success: false },
      fullAnswer: null,
      preview: "",
      stopReason: "timeout",
      usage: [],
      monetaryCost: null,
      cacheState: "unknown" as const,
      wallTimeMs: 1,
    },
  ];
  const verified = verifySmallRun({ run, results });
  expect(verified.summary.primaryCompletePairs).toBe(1);
  expect(verified.summary.diagnosticFailures).toBe(1);
  expect(() => appendResults(results, results[0]!)).toThrow(SmallRunnerError);
});

it("accepts an empty preflight run without collapsing planned ITT to zero", () => {
  const verified = verifySmallRun({
    run: {
      identity: identity(),
      plannedPairs: 24,
      liveEnabled: false,
      status: "preflight",
      monetaryCost: null,
      summary: { primaryCompletePairs: 0, plannedPairs: 24, diagnosticFailures: 0, ittPairs: 24 },
    },
    results: [],
  });
  expect(verified.summary.plannedPairs).toBe(24);
  expect(verified.summary.ittPairs).toBe(24);
  expect(() => verifySmallRun({
    run: { identity: identity(), plannedPairs: 24, liveEnabled: false, status: "complete", monetaryCost: null },
    results: [],
  })).toThrowError(expect.objectContaining({ code: "PCR_SMALL_RUNNER_INPUT_INVALID" }));
});

it("refreshes a preflight directory but refuses to resume a complete run after identity drift", () => {
  resumeGuard(
    { identity: identity(), plannedPairs: 24, liveEnabled: false, status: "preflight", monetaryCost: null },
    identity({ sourceSetSha256: "ee".repeat(32) }),
    false,
  );
  expect(() => resumeGuard(
    { identity: identity(), plannedPairs: 1, liveEnabled: true, status: "complete", monetaryCost: null },
    identity({ sourceSetSha256: "ee".repeat(32) }),
    true,
  )).toThrowError(expect.objectContaining({ code: "PCR_SMALL_RUNNER_RESUME_MISMATCH" }));
});
