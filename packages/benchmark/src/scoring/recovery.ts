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
