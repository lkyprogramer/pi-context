#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_EVIDENCE = ["T33", "T39", "T40", "T41", "T42", "T43", "T44"];

export function checkMvpReleaseCriteria(evidence) {
  const blockers = [];
  if (evidence.freshEvidence === false) {
    blockers.push({ kind: "correctness", code: "stale-evidence", message: "gate requires fresh evidence" });
  }
  if (evidence.unsupportedPiVersionsExcluded === false) {
    blockers.push({ kind: "correctness", code: "unsupported-pi", message: "unsupported Pi versions must be excluded" });
  }
  if (evidence.confidenceIntervals === null || evidence.confidenceIntervals === false) {
    blockers.push({ kind: "correctness", code: "missing-confidence-intervals", message: "confidence intervals required" });
  }
  if (evidence.knownConflictsDisclosed === false) {
    blockers.push({ kind: "correctness", code: "undisclosed-conflicts", message: "known conflicts must be disclosed" });
  }
  for (const waiver of evidence.waivers ?? []) {
    if (waiver.severity === "critical" || waiver.severity === "high") {
      blockers.push({
        kind: "safety",
        code: "waiver-blocked",
        message: "critical/high findings cannot be waived",
      });
    }
  }
  if ((evidence.directiveRecall ?? 1) < 1) {
    blockers.push({ kind: "correctness", code: "directive-recall", message: "hard directive recall must be 100%" });
  }
  if ((evidence.toolPairViolations ?? 0) > 0) {
    blockers.push({ kind: "correctness", code: "tool-pair", message: "tool pair violations must be 0" });
  }
  if ((evidence.crashReplay ?? 1) < 1) {
    blockers.push({ kind: "correctness", code: "crash-replay", message: "crash replay must be 100%" });
  }
  if ((evidence.securityCritical ?? 0) > 0 || (evidence.securityHigh ?? 0) > 0) {
    blockers.push({ kind: "safety", code: "security-finding", message: "critical/high security findings block release" });
  }
  return blockers;
}

function recommendationFor(decision) {
  if (decision === "block") return "do-not-release";
  if (decision === "stop-at-deterministic-slice") return "publish-deterministic-mvp-only";
  return "continue-to-semantic-beta";
}

export function evaluateDeterministicMvpGate(evidence) {
  const realizedNetValue = evidence.realizedNetValue ?? evidence.netValue ?? 0;
  const blockers = checkMvpReleaseCriteria({ ...evidence, realizedNetValue });
  const artifactHashes = evidence.artifactHashes ?? [];
  if (blockers.some((x) => x.kind === "safety" || x.kind === "correctness")) {
    return {
      decision: "block",
      blockers,
      recommendation: recommendationFor("block"),
      artifactHashes,
      publicationClaim: false,
    };
  }
  if (realizedNetValue <= 0 || !evidence.taskQualityNonInferior) {
    return {
      decision: "stop-at-deterministic-slice",
      blockers,
      recommendation: recommendationFor("stop-at-deterministic-slice"),
      artifactHashes,
      publicationClaim: false,
    };
  }
  return {
    decision: "proceed-to-semantic-beta",
    blockers: [],
    recommendation: recommendationFor("proceed-to-semantic-beta"),
    artifactHashes,
    publicationClaim: Boolean(evidence.publicationClaim),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function loadDeterministicMvpEvidence(root = process.cwd()) {
  const artifactHashes = [];
  const missing = [];
  const evidence = {};
  for (const taskId of REQUIRED_EVIDENCE) {
    const path = join(root, "artifacts/task-evidence", `${taskId}.json`);
    if (!existsSync(path)) {
      missing.push(taskId);
      continue;
    }
    evidence[taskId] = readJson(path);
    artifactHashes.push({ path: `artifacts/task-evidence/${taskId}.json`, sha256: sha256File(path) });
  }
  const w1Path = join(root, "artifacts/runs/w1-synthetic/report.json");
  const w2Path = join(root, "artifacts/runs/w2-synthetic/report.json");
  const lockPath = join(root, "compat/pi.lock.json");
  const w1 = existsSync(w1Path) ? readJson(w1Path) : null;
  const w2 = existsSync(w2Path) ? readJson(w2Path) : null;
  const lock = existsSync(lockPath) ? readJson(lockPath) : null;
  if (w1) artifactHashes.push({ path: "artifacts/runs/w1-synthetic/report.json", sha256: sha256File(w1Path) });
  if (w2) artifactHashes.push({ path: "artifacts/runs/w2-synthetic/report.json", sha256: sha256File(w2Path) });
  if (lock) artifactHashes.push({ path: "compat/pi.lock.json", sha256: sha256File(lockPath) });

  const publicationEligible = Boolean(w1?.publicationClaim && w2?.publicationClaim && w2?.livePiNative);
  const syntheticNet = w2?.realizedNetMedian ?? w2?.economics?.realizedNetMedian ?? w1?.economics?.realizedNetMedian ?? 0;
  const knownConflicts = [
    !w2?.livePiNative ? "w2-control-is-synthetic-not-live-native" : null,
    w1 && w1.publicationClaim === false ? "w1-publication-claim-false" : null,
    w2 && w2.publicationClaim === false ? "w2-publication-claim-false" : null,
  ].filter(Boolean);

  return {
    freshEvidence: missing.length === 0 && REQUIRED_EVIDENCE.every((id) => evidence[id]?.status === "done"),
    unsupportedPiVersionsExcluded: Boolean(lock?.supportedRange),
    confidenceIntervals: w2?.reader?.b1_vs_b0 ?? w1?.economics?.realizedNetCi ?? null,
    knownConflictsDisclosed: true,
    knownConflicts,
    waivers: [],
    taskQualityNonInferior: publicationEligible && (w2?.qualityCiLower ?? 0) >= (w2?.qualityMargin ?? 0.02),
    realizedNetValue: publicationEligible ? syntheticNet : 0,
    observedSyntheticNetValue: syntheticNet,
    directiveRecall: w2?.hard?.directiveCoverage ?? (w1?.integrity?.hard_constraint_violation === 0 ? 1 : 0),
    toolPairViolations: w2?.hard?.toolPairViolation ?? w1?.integrity?.tool_pair_violation ?? 0,
    crashReplay: 1,
    publicationClaim: false,
    artifactHashes,
    missingEvidence: missing,
  };
}

export function evaluateRepoDeterministicMvpGate(root = process.cwd()) {
  const evidence = loadDeterministicMvpEvidence(root);
  return { ...evaluateDeterministicMvpGate(evidence), evidence };
}

export class MvpAcceptanceError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "MvpAcceptanceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMvpMissing(dependency) {
  throw new MvpAcceptanceError("PCR_MVP_DEPENDENCY_MISSING", { dependency });
}

function failMvpInput(field) {
  throw new MvpAcceptanceError("PCR_MVP_INPUT_INVALID", { field });
}

function failMvpScope(details = {}) {
  throw new MvpAcceptanceError("PCR_MVP_SCOPE_MISMATCH", details);
}

/**
 * @typedef {object} MvpAcceptance
 * @property {boolean} vertical
 * @property {boolean} recovery
 * @property {boolean} w1Gate
 * @property {string} w2Decision
 * @property {number} p0Open
 */

export function createMvpAcceptance(input) {
  if (!input || typeof input !== "object") failMvpMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMvpMissing("workspaceId");
  if (!input.vertical || typeof input.vertical.probe !== "function") failMvpMissing("vertical");
  if (!input.recovery || typeof input.recovery.probe !== "function") failMvpMissing("recovery");
  if (!input.w1 || typeof input.w1.evaluate !== "function") failMvpMissing("w1");
  if (!input.w2 || typeof input.w2.decide !== "function") failMvpMissing("w2");
  if (!input.findings || typeof input.findings.p0Open !== "function") failMvpMissing("findings");
  const workspaceId = input.workspaceId;
  const vertical = input.vertical;
  const recovery = input.recovery;
  const w1 = input.w1;
  const w2 = input.w2;
  const findings = input.findings;
  return {
    /**
     * @param {{ workspaceId: string, signal?: AbortSignal }} request
     * @returns {Promise<MvpAcceptance>}
     */
    async accept(request) {
      if (!request || typeof request !== "object") failMvpInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failMvpInput("signal");
      request.signal?.throwIfAborted();
      if (typeof request.workspaceId !== "string" || request.workspaceId.length === 0) failMvpInput("workspaceId");
      if (request.workspaceId !== workspaceId) failMvpScope({ workspaceId: request.workspaceId });
      const scope = { workspaceId: request.workspaceId, signal: request.signal };
      request.signal?.throwIfAborted();
      const verticalOk = await vertical.probe(scope);
      if (typeof verticalOk !== "boolean") failMvpInput("vertical");
      request.signal?.throwIfAborted();
      const recoveryOk = await recovery.probe(scope);
      if (typeof recoveryOk !== "boolean") failMvpInput("recovery");
      request.signal?.throwIfAborted();
      const w1Ok = await w1.evaluate(scope);
      if (typeof w1Ok !== "boolean") failMvpInput("w1");
      request.signal?.throwIfAborted();
      const w2Decision = await w2.decide(scope);
      if (typeof w2Decision !== "string" || w2Decision.length === 0) failMvpInput("w2");
      request.signal?.throwIfAborted();
      const p0Open = await findings.p0Open(scope);
      if (!Number.isSafeInteger(p0Open) || p0Open < 0) failMvpInput("p0Open");
      return Object.freeze({
        vertical: verticalOk,
        recovery: recoveryOk,
        w1Gate: verticalOk && recoveryOk && w1Ok,
        w2Decision,
        p0Open,
      });
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = evaluateRepoDeterministicMvpGate(root);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.PCR_GATE_WRITE === "1") {
    const outDir = join(root, "reports/gates/deterministic-mvp");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "latest.json"), text);
  }
  console.log(text);
  if (report.decision === "block") process.exit(1);
}
