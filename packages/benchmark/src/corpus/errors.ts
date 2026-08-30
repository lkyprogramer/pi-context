export type CorpusErrorCode =
  | "PCR_CORPUS_DEPENDENCY_MISSING"
  | "PCR_CORPUS_INPUT_INVALID"
  | "PCR_CORPUS_SCOPE_MISMATCH"
  | "PCR_CORPUS_LOCK_CONFLICT";

export class CorpusGovernorError extends TypeError {
  readonly code: CorpusErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CorpusErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CorpusGovernorError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function failMissing(dependency: string): never {
  throw new CorpusGovernorError("PCR_CORPUS_DEPENDENCY_MISSING", { dependency });
}

export function failInput(field: string): never {
  throw new CorpusGovernorError("PCR_CORPUS_INPUT_INVALID", { field });
}

export function failScope(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_SCOPE_MISMATCH", details);
}

export function failConflict(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_LOCK_CONFLICT", details);
}
