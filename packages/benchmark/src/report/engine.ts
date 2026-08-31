import { createHash } from "node:crypto";

export type GateName = "w1-early-net-value" | "w2-compactor" | "semantic-beta";

export type GateDecisionKind =
  | "proceed-to-w2"
  | "keep-reducers-only"
  | "keep-recovery-only"
  | "stop"
  | "repeat-after-infrastructure-fix"
  | "adopt-pcr-compactor"
  | "keep-pi-native"
  | "proceed-to-semantic";

export interface IntegritySlice {
  oracleValidity: number;
  directiveCoverage: number;
  toolPairViolations: number;
  recoveryRate: number;
  deterministicHashStable: boolean;
  leakCount: number;
  unsupportedHighRisk: number;
  crossScopeReads: number;
}

export interface EfficiencySlice {
  realizedNetMedian: number;
  ingressTokenMedianDelta: number;
  ingressTokenCiUpper: number;
  hookP95Ms: number;
  recallAt5: number;
  recallPrecision: number;
  silenceRate: number;
  recallQualityCiLower: number;
  recallNeededSuccessDelta: number;
}

export interface RunProvenance {
  commit: string;
  diffHash: string;
  dirty: boolean;
  modelKey: string;
  configDigest: string;
}

export interface RunBundle {
  runId: string;
  gate: GateName;
  workspaceId: string;
  integrity: IntegritySlice;
  continuation: { environmentSuccess: boolean };
  quality: { environmentSuccessLower: number };
  efficiency: EfficiencySlice;
  provenance: RunProvenance;
  signal?: AbortSignal;
}

export interface GateDecision {
  runId: string;
  gate: GateName;
  decision: GateDecisionKind;
  hardGatePass: boolean;
  reasons: readonly string[];
  reportSha256: string;
}

export interface GitSnapshot {
  status(scope: { workspaceId: string }, signal?: AbortSignal): Promise<{ commit: string; diffHash: string; dirty: boolean }>;
}

export interface GateFileStore {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

export interface GateEngine {
  evaluate(bundle: RunBundle): GateDecision;
  writeImmutableBundle(bundle: RunBundle, out: string): Promise<string>;
}

export interface CreateGateEngineInput {
  workspaceId: string;
  git: GitSnapshot;
  files: GateFileStore;
}

export type GateErrorCode =
  | "PCR_GATE_DEPENDENCY_MISSING"
  | "PCR_GATE_INPUT_INVALID"
  | "PCR_GATE_SCOPE_MISMATCH";

export class GateEngineError extends TypeError {
  readonly code: GateErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: GateErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "GateEngineError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const GATES = new Set<GateName>(["w1-early-net-value", "w2-compactor", "semantic-beta"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const EMPTY_DIFF_HASH = createHash("sha256").update("").digest("hex");
const QUALITY_MARGIN = 0.02;

function failMissing(dependency: string): never {
  throw new GateEngineError("PCR_GATE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new GateEngineError("PCR_GATE_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new GateEngineError("PCR_GATE_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) failInput(field);
}

function requireCount(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) failInput(field);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function snapshotBundle(bundle: RunBundle): Omit<RunBundle, "signal"> {
  return {
    runId: bundle.runId,
    gate: bundle.gate,
    workspaceId: bundle.workspaceId,
    integrity: { ...bundle.integrity },
    continuation: { ...bundle.continuation },
    quality: { ...bundle.quality },
    efficiency: { ...bundle.efficiency },
    provenance: { ...bundle.provenance },
  };
}

function parseBundle(bundle: RunBundle): RunBundle {
  if (!bundle || typeof bundle !== "object") failInput("bundle");
  if (bundle.signal !== undefined && !(bundle.signal instanceof AbortSignal)) failInput("signal");
  requireNonEmpty(bundle.runId, "runId");
  if (!GATES.has(bundle.gate)) failInput("gate");
  requireNonEmpty(bundle.workspaceId, "workspaceId");
  if (!bundle.integrity || typeof bundle.integrity !== "object") failInput("integrity");
  requireFinite(bundle.integrity.oracleValidity, "integrity.oracleValidity");
  requireFinite(bundle.integrity.directiveCoverage, "integrity.directiveCoverage");
  requireCount(bundle.integrity.toolPairViolations, "integrity.toolPairViolations");
  requireFinite(bundle.integrity.recoveryRate, "integrity.recoveryRate");
  if (typeof bundle.integrity.deterministicHashStable !== "boolean") failInput("integrity.deterministicHashStable");
  requireCount(bundle.integrity.leakCount, "integrity.leakCount");
  requireCount(bundle.integrity.unsupportedHighRisk, "integrity.unsupportedHighRisk");
  requireCount(bundle.integrity.crossScopeReads, "integrity.crossScopeReads");
  if (!bundle.continuation || typeof bundle.continuation.environmentSuccess !== "boolean") failInput("continuation");
  if (!bundle.quality || typeof bundle.quality !== "object") failInput("quality");
  requireFinite(bundle.quality.environmentSuccessLower, "quality.environmentSuccessLower");
  if (!bundle.efficiency || typeof bundle.efficiency !== "object") failInput("efficiency");
  requireFinite(bundle.efficiency.realizedNetMedian, "efficiency.realizedNetMedian");
  requireFinite(bundle.efficiency.ingressTokenMedianDelta, "efficiency.ingressTokenMedianDelta");
  requireFinite(bundle.efficiency.ingressTokenCiUpper, "efficiency.ingressTokenCiUpper");
  requireFinite(bundle.efficiency.hookP95Ms, "efficiency.hookP95Ms");
  requireFinite(bundle.efficiency.recallAt5, "efficiency.recallAt5");
  requireFinite(bundle.efficiency.recallPrecision, "efficiency.recallPrecision");
  requireFinite(bundle.efficiency.silenceRate, "efficiency.silenceRate");
  requireFinite(bundle.efficiency.recallQualityCiLower, "efficiency.recallQualityCiLower");
  requireFinite(bundle.efficiency.recallNeededSuccessDelta, "efficiency.recallNeededSuccessDelta");
  if (!bundle.provenance || typeof bundle.provenance !== "object") failInput("provenance");
  if (typeof bundle.provenance.commit !== "string" || !COMMIT_PATTERN.test(bundle.provenance.commit)) failInput("provenance.commit");
  if (typeof bundle.provenance.diffHash !== "string" || !SHA256_PATTERN.test(bundle.provenance.diffHash)) failInput("provenance.diffHash");
  if (typeof bundle.provenance.dirty !== "boolean") failInput("provenance.dirty");
  requireNonEmpty(bundle.provenance.modelKey, "provenance.modelKey");
  if (typeof bundle.provenance.configDigest !== "string" || !SHA256_PATTERN.test(bundle.provenance.configDigest)) {
    failInput("provenance.configDigest");
  }
  return bundle;
}

function integrityPass(slice: IntegritySlice): boolean {
  return slice.oracleValidity === 1
    && slice.directiveCoverage === 1
    && slice.toolPairViolations === 0
    && slice.recoveryRate === 1
    && slice.deterministicHashStable
    && slice.leakCount === 0
    && slice.unsupportedHighRisk === 0
    && slice.crossScopeReads === 0;
}

function qualityPass(bundle: RunBundle): boolean {
  return bundle.continuation.environmentSuccess && bundle.quality.environmentSuccessLower >= -QUALITY_MARGIN;
}

function w1Decision(bundle: RunBundle): GateDecisionKind {
  const ingress = bundle.efficiency.ingressTokenMedianDelta <= -0.2
    && bundle.efficiency.ingressTokenCiUpper <= -0.1
    && bundle.efficiency.hookP95Ms <= 75;
  const recall = bundle.efficiency.recallAt5 >= 0.9
    && bundle.efficiency.recallPrecision >= 0.75
    && bundle.efficiency.silenceRate >= 0.9
    && bundle.efficiency.recallQualityCiLower >= -0.01
    && bundle.efficiency.recallNeededSuccessDelta > 0;
  if (ingress && recall && bundle.efficiency.realizedNetMedian > 0) return "proceed-to-w2";
  if (ingress) return "keep-reducers-only";
  return bundle.efficiency.realizedNetMedian >= 0 ? "keep-recovery-only" : "stop";
}

function decide(bundle: RunBundle): { decision: GateDecisionKind; hardGatePass: boolean; reasons: string[] } {
  const clean = !bundle.provenance.dirty && bundle.provenance.diffHash === EMPTY_DIFF_HASH;
  const hard = integrityPass(bundle.integrity);
  if (!clean) {
    return { decision: "repeat-after-infrastructure-fix", hardGatePass: false, reasons: ["dirty-tree"] };
  }
  if (!hard) {
    return { decision: "stop", hardGatePass: false, reasons: ["integrity"] };
  }
  if (!qualityPass(bundle)) {
    if (bundle.gate === "w2-compactor") {
      return { decision: "keep-pi-native", hardGatePass: true, reasons: ["environment-quality"] };
    }
    return { decision: "stop", hardGatePass: true, reasons: ["environment-quality"] };
  }
  if (bundle.gate === "w1-early-net-value") {
    const decision = w1Decision(bundle);
    return { decision, hardGatePass: true, reasons: [decision] };
  }
  if (bundle.gate === "w2-compactor") {
    const decision = bundle.efficiency.realizedNetMedian > 0 ? "adopt-pcr-compactor" : "keep-pi-native";
    return { decision, hardGatePass: true, reasons: [decision] };
  }
  return { decision: "proceed-to-semantic", hardGatePass: true, reasons: ["proceed-to-semantic"] };
}

export function createGateEngine(input: CreateGateEngineInput): GateEngine {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMissing("workspaceId");
  if (!input.git || typeof input.git.status !== "function") failMissing("git");
  if (!input.files || typeof input.files.mkdir !== "function" || typeof input.files.writeFile !== "function") {
    failMissing("files");
  }
  const workspaceId = input.workspaceId;
  const git = input.git;
  const files = input.files;
  const evaluate = (sample: RunBundle): GateDecision => {
    const bundle = parseBundle(sample);
    const reportSha256 = sha256Text(canonicalJson(snapshotBundle(bundle)));
    const decided = decide(bundle);
    return Object.freeze({
      runId: bundle.runId,
      gate: bundle.gate,
      decision: decided.decision,
      hardGatePass: decided.hardGatePass,
      reasons: Object.freeze([...decided.reasons]),
      reportSha256,
    });
  };
  return {
    evaluate,
    async writeImmutableBundle(sample: RunBundle, out: string): Promise<string> {
      if (!sample || typeof sample !== "object") failInput("bundle");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      requireNonEmpty(out, "out");
      const bundle = parseBundle(sample);
      if (bundle.workspaceId !== workspaceId) failScope({ workspaceId: bundle.workspaceId });
      const decision = evaluate(bundle);
      sample.signal?.throwIfAborted();
      let snapshot: { commit: string; diffHash: string; dirty: boolean };
      try {
        snapshot = await git.status({ workspaceId: bundle.workspaceId }, sample.signal);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
          failScope({ workspaceId: bundle.workspaceId, port: "git" });
        }
        throw error;
      }
      if (
        !snapshot
        || typeof snapshot.commit !== "string"
        || snapshot.commit !== bundle.provenance.commit
        || snapshot.diffHash !== bundle.provenance.diffHash
        || snapshot.dirty !== bundle.provenance.dirty
      ) {
        failInput("provenance");
      }
      const root = out.endsWith("/") ? out.slice(0, -1) : out;
      const dir = `${root}/${decision.reportSha256}`;
      sample.signal?.throwIfAborted();
      await files.mkdir(dir);
      const payload = Buffer.from(canonicalJson({ bundle: snapshotBundle(bundle), decision }), "utf8");
      await files.writeFile(`${dir}/bundle.json`, payload);
      await files.writeFile(`${dir}/decision.json`, Buffer.from(canonicalJson(decision), "utf8"));
      return decision.reportSha256;
    },
  };
}
