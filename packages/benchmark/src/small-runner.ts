import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createIsolatedArmHomes, type IsolatedArmHome } from "./arms/isolate.js";
import { latinSquareOrder } from "./runner/replicate-policy.js";
import { scoreProbe, type ProbeFamily, type ProbeScore } from "./scoring/probe.js";

export type AttemptStatus = "completed" | "timeout" | "failed" | "not-run";
export type PrimaryArm = "B0" | "B2";
export type DiagnosticArm = "B1" | "F0";
export type SmallArm = PrimaryArm | DiagnosticArm;
export type CacheState = "cold" | "warm" | "unknown";
export type CanaryDecision = "reject" | "inconclusive" | "keep-native" | "canary-experimental";

export interface Attempt {
  status: AttemptStatus;
  success: boolean;
}

export interface PairAttempts {
  id: string;
  clusterId: string;
  repeat: number;
  B0: Attempt;
  B2: Attempt;
  B1?: Attempt;
  F0?: Attempt;
}

export interface AttemptSummary {
  primaryCompletePairs: number;
  plannedPairs: number;
  diagnosticFailures: number;
  ittPairs: number;
}

export interface ScenarioOracle {
  kind: "requested-target" | "observed-state" | "permission";
  expected: string;
  sourceEntryId: string;
  sourceSha256: string;
}

export interface ScenarioSourceEntry {
  id: string;
  role: "user" | "tool" | "assistant";
  text: string;
}

export type ScenarioAssertion =
  | { kind: "file-equals"; path: string; expected: string }
  | { kind: "command-exit"; argv: string[]; expected: number }
  | { kind: "file-unchanged"; path: string; originalSha256: string }
  | { kind: "export-signature"; path: string; name: string; parameters: string[] }
  | { kind: "forbidden-action-count"; expected: 0 };

export interface Scenario {
  id: string;
  clusterId: string;
  provenance: "real-independent" | "adapted-real" | "synthetic";
  mode: "reader" | "coding";
  prompt: string;
  oracle: ScenarioOracle;
  sourceEntries: ScenarioSourceEntry[];
  workspaceFiles: Record<string, string>;
  assertions: ScenarioAssertion[];
}

export interface RunIdentity {
  sourceSetSha256: string;
  hostPatchSha256: string;
  modelFingerprint: string;
  corpusSha256: string;
  configSha256: string;
  scorerRevision: string;
}

export type SmallRunnerErrorCode =
  | "PCR_SMALL_RUNNER_INPUT_INVALID"
  | "PCR_SMALL_RUNNER_RESUME_MISMATCH"
  | "PCR_SMALL_RUNNER_DUPLICATE_PAIR"
  | "PCR_SMALL_RUNNER_LIVE_DISABLED"
  | "PCR_SCENARIO_STATE_UNWITNESSED"
  | "PCR_SCENARIO_TARGET_DEPLOYED";

export class SmallRunnerError extends TypeError {
  readonly code: SmallRunnerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SmallRunnerErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SmallRunnerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const SCORER_REVISION = "lean-v4-t07-probe";
export const HOST_PATCH_PATH = "patches/@earendil-works__pi-coding-agent@0.84.4.patch";
export const DEFAULT_SOURCE_SET_PATHS = Object.freeze([
  "packages/benchmark/src/small-runner.ts",
  "packages/benchmark/src/scoring/probe.ts",
  "packages/benchmark/src/scoring/recovery.ts",
  "packages/benchmark/src/statistics/paired-small.ts",
  "packages/runtime/src/telemetry/request-usage.ts",
  "package.json",
  "pnpm-lock.yaml",
  HOST_PATCH_PATH,
]);

const ATTEMPT_STATUSES: readonly AttemptStatus[] = ["completed", "timeout", "failed", "not-run"];
const PRIMARY_ARMS: readonly PrimaryArm[] = ["B0", "B2"];

function fail(code: SmallRunnerErrorCode, details: Record<string, unknown> = {}): never {
  throw new SmallRunnerError(code, details);
}

function failInput(field: string): never {
  fail("PCR_SMALL_RUNNER_INPUT_INVALID", { field });
}

export function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256Bytes(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireAttempt(value: unknown, field: string): Attempt {
  if (!value || typeof value !== "object") failInput(field);
  const record = value as Attempt;
  if (!ATTEMPT_STATUSES.includes(record.status)) failInput(`${field}.status`);
  if (typeof record.success !== "boolean") failInput(`${field}.success`);
  if (record.success && record.status !== "completed") failInput(`${field}.success`);
  return { status: record.status, success: record.success };
}

function diagnosticFailed(attempt: Attempt | undefined): boolean {
  return attempt !== undefined && (attempt.status === "timeout" || attempt.status === "failed");
}

export function summarizeAttempts(rows: readonly PairAttempts[]): AttemptSummary {
  if (!Array.isArray(rows)) failInput("rows");
  const seen = new Set<string>();
  let primaryCompletePairs = 0;
  let diagnosticFailures = 0;
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object") failInput(`rows[${index}]`);
    if (typeof row.id !== "string" || row.id.length === 0) failInput(`rows[${index}].id`);
    if (typeof row.clusterId !== "string" || row.clusterId.length === 0) failInput(`rows[${index}].clusterId`);
    if (!Number.isSafeInteger(row.repeat) || row.repeat < 0) failInput(`rows[${index}].repeat`);
    const key = `${row.id}#${row.repeat}`;
    if (seen.has(key)) {
      fail("PCR_SMALL_RUNNER_DUPLICATE_PAIR", { id: row.id, repeat: row.repeat });
    }
    seen.add(key);
    const b0 = requireAttempt(row.B0, `rows[${index}].B0`);
    const b2 = requireAttempt(row.B2, `rows[${index}].B2`);
    if (b0.status === "completed" && b2.status === "completed") primaryCompletePairs += 1;
    if (diagnosticFailed(row.B1)) diagnosticFailures += 1;
    if (diagnosticFailed(row.F0)) diagnosticFailures += 1;
  }
  return {
    primaryCompletePairs,
    plannedPairs: rows.length,
    diagnosticFailures,
    ittPairs: rows.length,
  };
}

function requireSourceEntry(value: unknown, field: string): ScenarioSourceEntry {
  if (!value || typeof value !== "object") failInput(field);
  const entry = value as ScenarioSourceEntry;
  if (typeof entry.id !== "string" || entry.id.length === 0) failInput(`${field}.id`);
  if (entry.role !== "user" && entry.role !== "tool" && entry.role !== "assistant") failInput(`${field}.role`);
  if (typeof entry.text !== "string") failInput(`${field}.text`);
  return { id: entry.id, role: entry.role, text: entry.text };
}

export function validateScenario(input: unknown): Scenario {
  if (!input || typeof input !== "object") failInput("scenario");
  const row = input as Scenario;
  if (typeof row.id !== "string" || row.id.length === 0) failInput("id");
  if (typeof row.clusterId !== "string" || row.clusterId.length === 0) failInput("clusterId");
  if (row.provenance !== "real-independent" && row.provenance !== "adapted-real" && row.provenance !== "synthetic") {
    failInput("provenance");
  }
  if (row.mode !== "reader" && row.mode !== "coding") failInput("mode");
  if (typeof row.prompt !== "string" || row.prompt.length === 0) failInput("prompt");
  if (!row.oracle || typeof row.oracle !== "object") failInput("oracle");
  if (row.oracle.kind !== "requested-target" && row.oracle.kind !== "observed-state" && row.oracle.kind !== "permission") {
    failInput("oracle.kind");
  }
  if (typeof row.oracle.expected !== "string" || row.oracle.expected.length === 0) failInput("oracle.expected");
  if (typeof row.oracle.sourceEntryId !== "string" || row.oracle.sourceEntryId.length === 0) failInput("oracle.sourceEntryId");
  if (typeof row.oracle.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.oracle.sourceSha256)) {
    failInput("oracle.sourceSha256");
  }
  if (row.oracle.kind === "requested-target" && /(?:already\s+)?deployed|已部署/iu.test(row.oracle.expected)) {
    fail("PCR_SCENARIO_TARGET_DEPLOYED", { expected: row.oracle.expected });
  }
  if (!Array.isArray(row.sourceEntries) || row.sourceEntries.length === 0) failInput("sourceEntries");
  const sourceEntries = row.sourceEntries.map((entry, index) => requireSourceEntry(entry, `sourceEntries[${index}]`));
  const source = sourceEntries.find((entry) => entry.id === row.oracle.sourceEntryId);
  if (!source) failInput("oracle.sourceEntryId");
  if (sha256Utf8(source.text) !== row.oracle.sourceSha256) failInput("oracle.sourceSha256");
  if (!row.workspaceFiles || typeof row.workspaceFiles !== "object" || Array.isArray(row.workspaceFiles)) {
    failInput("workspaceFiles");
  }
  const workspaceFiles = { ...row.workspaceFiles };
  if (!Array.isArray(row.assertions)) failInput("assertions");
  if (row.mode === "coding" && row.oracle.kind === "observed-state" && Object.keys(workspaceFiles).length === 0) {
    fail("PCR_SCENARIO_STATE_UNWITNESSED", { id: row.id });
  }
  return {
    id: row.id,
    clusterId: row.clusterId,
    provenance: row.provenance,
    mode: row.mode,
    prompt: row.prompt,
    oracle: {
      kind: row.oracle.kind,
      expected: row.oracle.expected,
      sourceEntryId: row.oracle.sourceEntryId,
      sourceSha256: row.oracle.sourceSha256,
    },
    sourceEntries,
    workspaceFiles,
    assertions: [...row.assertions],
  };
}

export function independentClusterCount(scenarios: readonly Pick<Scenario, "clusterId">[]): number {
  if (!Array.isArray(scenarios)) failInput("scenarios");
  const clusters = new Set<string>();
  for (const [index, row] of scenarios.entries()) {
    if (!row || typeof row.clusterId !== "string" || row.clusterId.length === 0) failInput(`scenarios[${index}].clusterId`);
    clusters.add(row.clusterId);
  }
  return clusters.size;
}

export function loadSmallCorpus(dir: string): { scenarios: Scenario[]; independentClusters: number } {
  if (typeof dir !== "string" || dir.length === 0) failInput("dir");
  if (!existsSync(dir)) failInput("dir");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const scenarios = files.map((name) => validateScenario(JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown));
  return { scenarios, independentClusters: independentClusterCount(scenarios) };
}

function loadTypescript(): typeof import("typescript") {
  const requireTs = createRequire(fileURLToPath(import.meta.url));
  return requireTs("typescript") as typeof import("typescript");
}

export function exportFunctionParameters(source: string, name: string): string[] {
  if (typeof source !== "string") failInput("source");
  if (typeof name !== "string" || name.length === 0) failInput("name");
  const ts = loadTypescript();
  const file = ts.createSourceFile("assertion.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== name) continue;
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!exported) continue;
    return statement.parameters.map((parameter) => parameter.name.getText(file));
  }
  return [];
}

export function evaluateScenarioAssertions(input: {
  workspaceDir: string;
  scenario: Scenario;
}): { ok: boolean; failures: readonly string[] } {
  if (!input || typeof input !== "object") failInput("input");
  const scenario = validateScenario(input.scenario);
  if (typeof input.workspaceDir !== "string" || input.workspaceDir.length === 0) failInput("workspaceDir");
  const failures: string[] = [];
  for (const assertion of scenario.assertions) {
    if (assertion.kind === "file-equals") {
      const actual = existsSync(join(input.workspaceDir, assertion.path))
        ? readFileSync(join(input.workspaceDir, assertion.path), "utf8")
        : "";
      if (actual !== assertion.expected) failures.push(`file-equals:${assertion.path}`);
    } else if (assertion.kind === "file-unchanged") {
      const actual = existsSync(join(input.workspaceDir, assertion.path))
        ? sha256Utf8(readFileSync(join(input.workspaceDir, assertion.path), "utf8"))
        : "";
      if (actual !== assertion.originalSha256) failures.push(`file-unchanged:${assertion.path}`);
    } else if (assertion.kind === "command-exit") {
      const result = spawnSync(assertion.argv[0]!, assertion.argv.slice(1), {
        cwd: input.workspaceDir,
        encoding: "utf8",
      });
      if ((result.status ?? 1) !== assertion.expected) failures.push(`command-exit:${assertion.argv.join(" ")}`);
    } else if (assertion.kind === "export-signature") {
      const source = existsSync(join(input.workspaceDir, assertion.path))
        ? readFileSync(join(input.workspaceDir, assertion.path), "utf8")
        : "";
      const parameters = exportFunctionParameters(source, assertion.name);
      if (parameters.join(",") !== assertion.parameters.join(",")) {
        failures.push(`export-signature:${assertion.name}`);
      }
    } else if (assertion.kind === "forbidden-action-count") {
      const haystack = Object.values(scenario.workspaceFiles).join("\n");
      const forbidden = /deploy\s+prod|rm\s+-rf\s+\/|curl\s+https:\/\//iu.test(haystack);
      if (forbidden) failures.push("forbidden-action-count");
    }
  }
  return { ok: failures.length === 0, failures };
}

export function assertResumeIdentity(previous: RunIdentity, next: RunIdentity): void {
  if (!previous || typeof previous !== "object" || !next || typeof next !== "object") failInput("runIdentity");
  const keys: Array<keyof RunIdentity> = [
    "sourceSetSha256",
    "hostPatchSha256",
    "modelFingerprint",
    "corpusSha256",
    "configSha256",
    "scorerRevision",
  ];
  for (const key of keys) {
    if (typeof previous[key] !== "string" || previous[key].length === 0) failInput(`previous.${key}`);
    if (typeof next[key] !== "string" || next[key].length === 0) failInput(`next.${key}`);
    if (previous[key] !== next[key]) {
      fail("PCR_SMALL_RUNNER_RESUME_MISMATCH", { field: key, previous: previous[key], next: next[key] });
    }
  }
}

export function recordedMonetaryCost(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) failInput("monetaryCost");
  return value;
}

export function scoreRecordedAnswer(input: {
  expected: string;
  family: ProbeFamily;
  fullAnswer?: string | null;
  preview?: string;
}): ProbeScore {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.expected !== "string" || input.expected.length === 0) failInput("expected");
  const full = typeof input.fullAnswer === "string" ? input.fullAnswer : "";
  const preview = typeof input.preview === "string" ? input.preview : "";
  if (full.trim().length === 0) {
    return scoreProbe({ expected: input.expected, observed: "", family: input.family, fullAnswer: false });
  }
  if (preview.length >= 400 && full === preview) {
    return scoreProbe({ expected: input.expected, observed: full, family: input.family, fullAnswer: false });
  }
  return scoreProbe({ expected: input.expected, observed: full, family: input.family, fullAnswer: true });
}

export function attemptFromScore(status: AttemptStatus, score: ProbeScore, fullAnswer: string): Attempt {
  if (!ATTEMPT_STATUSES.includes(status)) failInput("status");
  const success = status === "completed" && score.ok === true && fullAnswer.trim().length > 0 && score.skipped !== true;
  return { status, success };
}

export function hashSourceSet(
  paths: readonly string[],
  read: (path: string) => Uint8Array | string = (path) => readFileSync(path),
): string {
  if (!Array.isArray(paths) || paths.length === 0) failInput("paths");
  const payload = paths.map((path) => {
    if (typeof path !== "string" || path.length === 0) failInput("paths");
    const raw = read(path);
    const sha256 = typeof raw === "string" ? sha256Utf8(raw) : sha256Bytes(raw);
    return { path, sha256 };
  });
  return sha256Utf8(JSON.stringify(payload));
}

export function primaryArmOrder(repeat: number): readonly [PrimaryArm, PrimaryArm] {
  if (!Number.isSafeInteger(repeat) || repeat < 0) failInput("repeat");
  const ordered = latinSquareOrder(PRIMARY_ARMS, repeat);
  return [ordered[0]!, ordered[1]!];
}

export interface PlannedPair {
  id: string;
  clusterId: string;
  repeat: number;
  order: readonly [PrimaryArm, PrimaryArm];
}

export function planPrimaryPairs(input: {
  scenarios: readonly Pick<Scenario, "id" | "clusterId">[];
  repeats: number;
}): PlannedPair[] {
  if (!input || typeof input !== "object") failInput("input");
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) failInput("scenarios");
  if (!Number.isSafeInteger(input.repeats) || input.repeats < 1) failInput("repeats");
  const seenIds = new Set<string>();
  const planned: PlannedPair[] = [];
  for (const scenario of input.scenarios) {
    if (!scenario || typeof scenario.id !== "string" || scenario.id.length === 0) failInput("scenarios.id");
    if (typeof scenario.clusterId !== "string" || scenario.clusterId.length === 0) failInput("scenarios.clusterId");
    if (seenIds.has(scenario.id)) fail("PCR_SMALL_RUNNER_DUPLICATE_PAIR", { id: scenario.id });
    seenIds.add(scenario.id);
    for (let repeat = 0; repeat < input.repeats; repeat += 1) {
      planned.push({
        id: scenario.id,
        clusterId: scenario.clusterId,
        repeat,
        order: primaryArmOrder(repeat),
      });
    }
  }
  return planned;
}

export function decideCanary(input: {
  integrityFailures: number;
  recoveryTested: number;
  recoveryPassed: number;
  criticalRegressions: number;
  completedPairs: number;
  plannedPairs: number;
  medianTaskInputDelta: number | null;
  medianWallTimeDelta: number | null;
}): CanaryDecision {
  if (!input || typeof input !== "object") failInput("input");
  const ints = [
    "integrityFailures",
    "recoveryTested",
    "recoveryPassed",
    "criticalRegressions",
    "completedPairs",
    "plannedPairs",
  ] as const;
  for (const key of ints) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) failInput(key);
  }
  if (input.plannedPairs < 1) failInput("plannedPairs");
  if (input.completedPairs > input.plannedPairs) failInput("completedPairs");
  if (input.recoveryPassed > input.recoveryTested) failInput("recoveryPassed");
  const deltas = [input.medianTaskInputDelta, input.medianWallTimeDelta];
  for (const [index, delta] of deltas.entries()) {
    if (delta !== null && (typeof delta !== "number" || !Number.isFinite(delta))) {
      failInput(index === 0 ? "medianTaskInputDelta" : "medianWallTimeDelta");
    }
  }
  if (input.integrityFailures > 0 || input.criticalRegressions > 0) return "reject";
  if (input.recoveryTested < 5 || input.recoveryPassed !== input.recoveryTested || input.completedPairs < input.plannedPairs) {
    return "inconclusive";
  }
  const known = deltas.filter((value): value is number => value !== null);
  if (known.length === 0) return "keep-native";
  const improved = known.some((value) => value <= -0.10);
  const regressing = known.some((value) => value > 0.10);
  if (improved && !regressing) return "canary-experimental";
  return "keep-native";
}

export interface SmallPreflight {
  liveEnabled: boolean;
  credentialIsolation: boolean;
  toolsEnabledAllowed: boolean;
  isolationReason: string;
  identity: RunIdentity;
  configPath: string;
  contextWindow: number;
  providerModel: string;
}

export interface CanaryConfig {
  liveEnabled: boolean;
  requireToolCredentialIsolation: boolean;
  providerModel: string;
  contextWindow: number;
  repeats: number;
  independentTasksRequired: number;
  scenarioFiles: string[];
  host?: { patchSha256?: string; piVersion?: string; nodeVersion?: string };
  arms?: string[];
  maxMonetaryCost?: number | null;
}

function parseCanaryConfig(text: string): CanaryConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    failInput("config");
  }
  if (!parsed || typeof parsed !== "object") failInput("config");
  const config = parsed as CanaryConfig;
  if (typeof config.liveEnabled !== "boolean") failInput("liveEnabled");
  if (config.requireToolCredentialIsolation !== true) failInput("requireToolCredentialIsolation");
  if (typeof config.providerModel !== "string" || config.providerModel.length === 0) failInput("providerModel");
  if (!Number.isSafeInteger(config.contextWindow) || config.contextWindow !== 200_192) failInput("contextWindow");
  if (!Number.isSafeInteger(config.repeats) || config.repeats < 1) failInput("repeats");
  if (!Number.isSafeInteger(config.independentTasksRequired) || config.independentTasksRequired < 1) {
    failInput("independentTasksRequired");
  }
  if (!Array.isArray(config.scenarioFiles)) failInput("scenarioFiles");
  return config;
}

export function loadHostPatchSha256(cwd: string, read: (path: string) => Uint8Array = (path) => readFileSync(path)): string {
  return sha256Bytes(read(resolve(cwd, HOST_PATCH_PATH)));
}

export function preflightSmallRun(input: {
  configPath: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  sourcePaths?: readonly string[];
}): SmallPreflight {
  if (!input || typeof input !== "object") failInput("input");
  const cwd = input.cwd ?? process.cwd();
  const configPath = resolve(cwd, input.configPath);
  if (!existsSync(configPath)) failInput("configPath");
  const configText = readFileSync(configPath, "utf8");
  const config = parseCanaryConfig(configText);
  const env = input.env ?? process.env;
  const hostPatchSha256 = loadHostPatchSha256(cwd);
  if (typeof config.host?.patchSha256 === "string" && config.host.patchSha256 !== hostPatchSha256) {
    failInput("host.patchSha256");
  }
  const sourcePaths = input.sourcePaths ?? DEFAULT_SOURCE_SET_PATHS;
  const identity: RunIdentity = {
    sourceSetSha256: hashSourceSet(sourcePaths.map((path) => resolve(cwd, path))),
    hostPatchSha256,
    modelFingerprint: config.providerModel,
    corpusSha256: sha256Utf8(JSON.stringify(config.scenarioFiles)),
    configSha256: sha256Utf8(configText),
    scorerRevision: SCORER_REVISION,
  };
  return {
    liveEnabled: env.PCR_LIVE === "1",
    credentialIsolation: true,
    toolsEnabledAllowed: env.PCR_TOOLS_ENABLED_ALLOWED === "1",
    isolationReason: typeof env.PCR_ISOLATION_REASON === "string" && env.PCR_ISOLATION_REASON.length > 0
      ? env.PCR_ISOLATION_REASON
      : "unassessed",
    identity,
    configPath,
    contextWindow: config.contextWindow,
    providerModel: config.providerModel,
  };
}

export interface ArmRequestUsage {
  requestId: string;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  elapsedMs: number;
}

export interface ArmExecutionResult {
  status: AttemptStatus;
  fullAnswer: string;
  preview: string;
  stopReason: string | null;
  usage: readonly ArmRequestUsage[];
  toolCalls: readonly unknown[];
  cacheState: CacheState;
  monetaryCost: number | null;
  wallTimeMs: number;
}

export interface ArmExecutor {
  run(input: {
    arm: PrimaryArm;
    scenario: Scenario;
    home: IsolatedArmHome;
  }): Promise<ArmExecutionResult>;
}

export interface SmallRunRecord {
  pairId: string;
  clusterId: string;
  repeat: number;
  arm: SmallArm;
  attempt: Attempt;
  fullAnswer: string | null;
  preview: string;
  stopReason: string | null;
  usage: readonly ArmRequestUsage[];
  monetaryCost: number | null;
  cacheState: CacheState;
  wallTimeMs: number;
}

export function resultPairKey(record: Pick<SmallRunRecord, "pairId" | "repeat" | "arm">): string {
  return `${record.pairId}#${record.repeat}#${record.arm}`;
}

export function appendResults(existing: readonly SmallRunRecord[], next: SmallRunRecord): SmallRunRecord[] {
  if (!Array.isArray(existing)) failInput("existing");
  if (!next || typeof next !== "object") failInput("next");
  const key = resultPairKey(next);
  if (existing.some((row) => resultPairKey(row) === key)) {
    fail("PCR_SMALL_RUNNER_DUPLICATE_PAIR", { pairId: next.pairId, repeat: next.repeat, arm: next.arm });
  }
  return [...existing, next];
}

export function appendResultLine(path: string, record: SmallRunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as SmallRunRecord)
    : [];
  appendResults(existing, record);
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export interface SmallRunManifest {
  identity: RunIdentity;
  plannedPairs: number;
  liveEnabled: boolean;
  status: "preflight" | "running" | "complete" | "blocked";
  blockedReason?: string;
  decision?: CanaryDecision | null;
  summary?: AttemptSummary;
  monetaryCost: number | null;
}

export function verifySmallRun(input: {
  run: SmallRunManifest;
  results: readonly SmallRunRecord[];
  expectedIdentity?: RunIdentity;
}): { ok: true; summary: AttemptSummary } {
  if (!input || typeof input !== "object") failInput("input");
  if (!input.run || typeof input.run !== "object") failInput("run");
  if (input.expectedIdentity) assertResumeIdentity(input.run.identity, input.expectedIdentity);
  const records = [...input.results];
  if (records.length === 0) {
    if (input.run.status === "complete" && input.run.plannedPairs > 0) failInput("results");
    const summary = input.run.summary ?? {
      primaryCompletePairs: 0,
      plannedPairs: input.run.plannedPairs,
      diagnosticFailures: 0,
      ittPairs: input.run.plannedPairs,
    };
    return { ok: true, summary };
  }
  const seen = new Set<string>();
  const byPair = new Map<string, PairAttempts>();
  for (const record of records) {
    const key = resultPairKey(record);
    if (seen.has(key)) fail("PCR_SMALL_RUNNER_DUPLICATE_PAIR", { key });
    seen.add(key);
    if (recordedMonetaryCost(record.monetaryCost) !== record.monetaryCost) failInput("monetaryCost");
    const pairKey = `${record.pairId}#${record.repeat}`;
    const current = byPair.get(pairKey) ?? {
      id: record.pairId,
      clusterId: record.clusterId,
      repeat: record.repeat,
      B0: { status: "not-run", success: false },
      B2: { status: "not-run", success: false },
    };
    if (record.arm === "B0" || record.arm === "B2" || record.arm === "B1" || record.arm === "F0") {
      current[record.arm] = record.attempt;
    }
    byPair.set(pairKey, current);
  }
  const summary = summarizeAttempts([...byPair.values()]);
  if (input.run.plannedPairs !== summary.plannedPairs && input.run.status === "complete") {
    failInput("plannedPairs");
  }
  return { ok: true, summary };
}

export function verifySmallRunDir(dir: string, cwd = process.cwd()): { ok: true; summary: AttemptSummary } {
  const runPath = resolve(cwd, dir, "run.json");
  const resultsPath = resolve(cwd, dir, "results.jsonl");
  if (!existsSync(runPath)) failInput("run.json");
  const run = JSON.parse(readFileSync(runPath, "utf8")) as SmallRunManifest;
  const results = existsSync(resultsPath)
    ? readFileSync(resultsPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as SmallRunRecord)
    : [];
  return verifySmallRun({ run, results });
}

export function resumeGuard(previous: SmallRunManifest | null, next: RunIdentity, hasResults: boolean): void {
  if (!previous) return;
  if (hasResults || previous.status === "running" || previous.status === "complete") {
    assertResumeIdentity(previous.identity, next);
  }
}

export function writeRunArtifacts(dir: string, run: SmallRunManifest, reportMarkdown?: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  const summary = run.summary;
  const body = reportMarkdown ?? [
    "# Small canary run",
    "",
    `- status: ${run.status}`,
    `- liveEnabled: ${run.liveEnabled}`,
    `- plannedPairs: ${run.plannedPairs}`,
    `- primaryCompletePairs: ${summary?.primaryCompletePairs ?? 0}`,
    `- ittPairs: ${summary?.ittPairs ?? 0}`,
    `- diagnosticFailures: ${summary?.diagnosticFailures ?? 0}`,
    `- monetaryCost: ${run.monetaryCost === null ? "null" : String(run.monetaryCost)}`,
    `- decision: ${run.decision ?? "n/a"}`,
    run.blockedReason ? `- blockedReason: ${run.blockedReason}` : "",
    "",
  ].filter((line) => line !== undefined).join("\n");
  writeFileSync(resolve(dir, "report.md"), body.endsWith("\n") ? body : `${body}\n`);
}

export function isolatePrimaryHomes(input: {
  root: string;
  seedSessionFile: string;
  seedWorkspaceDir: string;
}): IsolatedArmHome[] {
  return createIsolatedArmHomes({
    ...input,
    arms: PRIMARY_ARMS,
  });
}

export async function executePlannedPair(input: {
  scenario: Scenario;
  planned: PlannedPair;
  root: string;
  seedSessionFile: string;
  seedWorkspaceDir: string;
  executor: ArmExecutor;
}): Promise<{ pair: PairAttempts; records: SmallRunRecord[]; homes: IsolatedArmHome[] }> {
  const scenario = validateScenario(input.scenario);
  if (input.planned.id !== scenario.id) failInput("planned.id");
  const homes = isolatePrimaryHomes({
    root: input.root,
    seedSessionFile: input.seedSessionFile,
    seedWorkspaceDir: input.seedWorkspaceDir,
  });
  const pair: PairAttempts = {
    id: scenario.id,
    clusterId: scenario.clusterId,
    repeat: input.planned.repeat,
    B0: { status: "not-run", success: false },
    B2: { status: "not-run", success: false },
  };
  const records: SmallRunRecord[] = [];
  for (const arm of input.planned.order) {
    const home = homes.find((row) => row.arm === arm);
    if (!home) failInput("homes");
    const executed = await input.executor.run({ arm, scenario, home });
    const score = scoreRecordedAnswer({
      expected: scenario.oracle.expected,
      family: "version",
      fullAnswer: executed.fullAnswer,
      preview: executed.preview,
    });
    const attempt = attemptFromScore(executed.status, score, executed.fullAnswer);
    pair[arm] = attempt;
    records.push({
      pairId: scenario.id,
      clusterId: scenario.clusterId,
      repeat: input.planned.repeat,
      arm,
      attempt,
      fullAnswer: executed.fullAnswer,
      preview: executed.preview,
      stopReason: executed.stopReason,
      usage: executed.usage,
      monetaryCost: recordedMonetaryCost(executed.monetaryCost),
      cacheState: executed.cacheState,
      wallTimeMs: executed.wallTimeMs,
    });
  }
  return { pair, records, homes };
}

function parseArgs(argv: readonly string[]): {
  preflight: boolean;
  verify: boolean;
  configPath: string;
  outDir: string;
} {
  const args = [...argv];
  const preflight = args.includes("--preflight");
  const verify = args.includes("--verify");
  const configIndex = args.indexOf("--config");
  const outIndex = args.indexOf("--out");
  const verifyIndex = args.indexOf("--verify");
  const configPath = configIndex >= 0 ? args[configIndex + 1] : "experiments/personal-canary.json";
  const verifyDir = verifyIndex >= 0 && args[verifyIndex + 1] && !args[verifyIndex + 1]!.startsWith("--")
    ? args[verifyIndex + 1]
    : undefined;
  const outDir = outIndex >= 0 ? args[outIndex + 1] : verifyDir ?? "artifacts/lean-v4";
  if (!configPath) failInput("config");
  if (!outDir) failInput("out");
  return { preflight, verify, configPath, outDir };
}

export async function runCli(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.verify) {
    const verified = verifySmallRunDir(parsed.outDir, cwd);
    process.stdout.write(`${JSON.stringify({ ok: verified.ok, summary: verified.summary })}\n`);
    return 0;
  }
  const report = preflightSmallRun({ configPath: parsed.configPath, env, cwd });
  const config = parseCanaryConfig(readFileSync(report.configPath, "utf8"));
  const plannedPairs = config.independentTasksRequired * config.repeats;
  const outDir = resolve(cwd, parsed.outDir);
  const existingRunPath = resolve(outDir, "run.json");
  const resultsPath = resolve(outDir, "results.jsonl");
  if (existsSync(existingRunPath)) {
    const previous = JSON.parse(readFileSync(existingRunPath, "utf8")) as SmallRunManifest;
    const hasResults = existsSync(resultsPath) && readFileSync(resultsPath, "utf8").trim().length > 0;
    resumeGuard(previous, report.identity, hasResults);
  }
  const liveRequested = report.liveEnabled && !parsed.preflight;
  if (!liveRequested) {
    const run: SmallRunManifest = {
      identity: report.identity,
      plannedPairs,
      liveEnabled: false,
      status: "preflight",
      monetaryCost: recordedMonetaryCost(config.maxMonetaryCost),
      decision: null,
      summary: { primaryCompletePairs: 0, plannedPairs, diagnosticFailures: 0, ittPairs: plannedPairs },
    };
    writeRunArtifacts(outDir, run);
    if (!existsSync(resultsPath)) writeFileSync(resultsPath, "");
    process.stdout.write(`${JSON.stringify({
      ok: true,
      live: false,
      preflight: true,
      identity: report.identity,
      plannedPairs,
      toolsEnabledAllowed: report.toolsEnabledAllowed,
      isolationReason: report.isolationReason,
      outDir,
    })}\n`);
    return 0;
  }
  if (report.toolsEnabledAllowed !== true) {
    const run: SmallRunManifest = {
      identity: report.identity,
      plannedPairs,
      liveEnabled: true,
      status: "blocked",
      blockedReason: report.isolationReason || "isolation-unproven",
      monetaryCost: null,
      decision: "inconclusive",
      summary: { primaryCompletePairs: 0, plannedPairs, diagnosticFailures: 0, ittPairs: plannedPairs },
    };
    writeRunArtifacts(outDir, run);
    process.stdout.write(`${JSON.stringify({ ok: true, live: true, status: "blocked", blockedReason: run.blockedReason, identity: report.identity })}\n`);
    return 0;
  }
  if (config.scenarioFiles.length === 0) {
    const run: SmallRunManifest = {
      identity: report.identity,
      plannedPairs,
      liveEnabled: true,
      status: "blocked",
      blockedReason: "scenario-files-empty",
      monetaryCost: null,
      decision: "inconclusive",
      summary: { primaryCompletePairs: 0, plannedPairs, diagnosticFailures: 0, ittPairs: plannedPairs },
    };
    writeRunArtifacts(outDir, run);
    process.stdout.write(`${JSON.stringify({ ok: true, live: true, status: "blocked", blockedReason: run.blockedReason, identity: report.identity })}\n`);
    return 0;
  }
  fail("PCR_SMALL_RUNNER_LIVE_DISABLED", { reason: "live-executor-is-t12", scenarioCount: config.scenarioFiles.length });
}

const invoked = typeof process.argv[1] === "string" && process.argv[1].includes("small-runner");
if (invoked) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    const err = error as { code?: string; message?: string };
    process.stderr.write(`${err.code ?? err.message ?? String(error)}\n`);
    process.exit(1);
  });
}
