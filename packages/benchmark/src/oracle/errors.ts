export type OracleErrorCode =
  | "PCR_ORACLE_DEPENDENCY_MISSING"
  | "PCR_ORACLE_INPUT_INVALID"
  | "PCR_ORACLE_SCOPE_MISMATCH";

export class OracleValidationError extends TypeError {
  readonly code: OracleErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: OracleErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "OracleValidationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function failMissing(dependency: string): never {
  throw new OracleValidationError("PCR_ORACLE_DEPENDENCY_MISSING", { dependency });
}

export function failInput(field: string): never {
  throw new OracleValidationError("PCR_ORACLE_INPUT_INVALID", { field });
}

export function failScope(details: Record<string, unknown> = {}): never {
  throw new OracleValidationError("PCR_ORACLE_SCOPE_MISMATCH", details);
}
