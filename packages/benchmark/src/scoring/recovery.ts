export interface ArtifactOracle {
  path: string;
  expected?: string;
  sha256?: string;
}

export interface ArtifactCoverage {
  covered: number;
  total: number;
  missing: string[];
  ok: boolean;
}

export interface RecoveryTrial {
  recovered: boolean;
}

export interface RecoveryCoverage {
  eligible: number;
  tested: number;
  pass: number;
  failed: number;
  status: "not-tested" | "tested";
  rate: number | null;
}

export function recoveryCountsFromSummary(summary: RecoverySummary): { recoveryTested: number; recoveryPassed: number } {
  if (!summary || typeof summary !== "object") failInput("summary");
  if (summary.status === "not-tested") return { recoveryTested: 0, recoveryPassed: 0 };
  return { recoveryTested: summary.attempted, recoveryPassed: summary.passed };
}

export type RecoveryErrorCode = "PCR_RECOVERY_INPUT_INVALID";

export class RecoveryScorerError extends TypeError {
  readonly code: RecoveryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RecoveryErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RecoveryScorerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new RecoveryScorerError("PCR_RECOVERY_INPUT_INVALID", { field });
}

/** Coverage of workspace artifacts against a source witness. Reader probe failure is not a missing directive. */
export function scoreArtifactCoverage(input: {
  artifacts: Record<string, string>;
  oracle: readonly ArtifactOracle[];
}): ArtifactCoverage {
  if (!input || typeof input !== "object") failInput("input");
  if (!input.artifacts || typeof input.artifacts !== "object" || Array.isArray(input.artifacts)) failInput("artifacts");
  if (!Array.isArray(input.oracle)) failInput("oracle");
  const missing: string[] = [];
  let covered = 0;
  for (const [index, row] of input.oracle.entries()) {
    if (!row || typeof row !== "object" || typeof row.path !== "string" || row.path.length === 0) {
      failInput(`oracle[${index}]`);
    }
    const actual = input.artifacts[row.path];
    if (typeof actual !== "string") {
      missing.push(row.path);
      continue;
    }
    if (row.expected !== undefined && actual !== row.expected) {
      missing.push(row.path);
      continue;
    }
    if (row.sha256 !== undefined && row.sha256 !== actual) {
      missing.push(row.path);
      continue;
    }
    covered += 1;
  }
  return {
    covered,
    total: input.oracle.length,
    missing,
    ok: missing.length === 0,
  };
}

export interface RecoveryCaseResult {
  eligible: boolean;
  attempted: boolean;
  exactBytesMatch: boolean | null;
  wrongScopeDenied: boolean | null;
}

export interface RecoverySummary {
  eligible: number;
  attempted: number;
  passed: number;
  passRate: number | null;
  status: "not-tested" | "partial" | "passed" | "failed";
}

export function summarizeRecovery(rows: readonly RecoveryCaseResult[]): RecoverySummary {
  if (!Array.isArray(rows)) failInput("rows");
  let eligible = 0;
  let attempted = 0;
  let passed = 0;
  let failedAttempt = false;
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object") failInput(`rows[${index}]`);
    if (typeof row.eligible !== "boolean") failInput(`rows[${index}].eligible`);
    if (typeof row.attempted !== "boolean") failInput(`rows[${index}].attempted`);
    if (row.exactBytesMatch !== null && typeof row.exactBytesMatch !== "boolean") {
      failInput(`rows[${index}].exactBytesMatch`);
    }
    if (row.wrongScopeDenied !== null && typeof row.wrongScopeDenied !== "boolean") {
      failInput(`rows[${index}].wrongScopeDenied`);
    }
    if (!row.eligible) continue;
    eligible += 1;
    if (!row.attempted) continue;
    attempted += 1;
    const ok = row.exactBytesMatch === true && row.wrongScopeDenied === true;
    if (ok) passed += 1;
    else failedAttempt = true;
  }
  if (eligible === 0) {
    return { eligible: 0, attempted: 0, passed: 0, passRate: null, status: "not-tested" };
  }
  if (attempted === 0) {
    return { eligible, attempted: 0, passed: 0, passRate: null, status: "partial" };
  }
  const passRate = passed / attempted;
  if (failedAttempt) {
    return { eligible, attempted, passed, passRate, status: "failed" };
  }
  if (attempted < eligible) {
    return { eligible, attempted, passed, passRate, status: "partial" };
  }
  return { eligible, attempted, passed, passRate, status: "passed" };
}

export function scoreRecoveryCoverage(input: {
  eligible: number;
  trials: readonly RecoveryTrial[];
}): RecoveryCoverage {
  if (!input || typeof input !== "object") failInput("input");
  if (!Number.isSafeInteger(input.eligible) || input.eligible < 0) failInput("eligible");
  if (!Array.isArray(input.trials)) failInput("trials");
  if (input.trials.length > input.eligible) failInput("trials");
  let pass = 0;
  let failed = 0;
  for (const [index, trial] of input.trials.entries()) {
    if (!trial || typeof trial !== "object" || typeof trial.recovered !== "boolean") failInput(`trials[${index}]`);
    if (trial.recovered) pass += 1;
    else failed += 1;
  }
  const tested = pass + failed;
  if (input.eligible === 0 || tested === 0) {
    return {
      eligible: input.eligible,
      tested: 0,
      pass: 0,
      failed: 0,
      status: "not-tested",
      rate: null,
    };
  }
  return {
    eligible: input.eligible,
    tested,
    pass,
    failed,
    status: "tested",
    rate: pass / tested,
  };
}
