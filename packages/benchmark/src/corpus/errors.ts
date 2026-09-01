export type CorpusErrorCode =
  | "PCR_CORPUS_DEPENDENCY_MISSING"
  | "PCR_CORPUS_INPUT_INVALID"
  | "PCR_CORPUS_SCOPE_MISMATCH"
  | "PCR_CORPUS_LOCK_CONFLICT"
  | "PCR_CORPUS_TEMPLATE_DUPLICATE"
  | "PCR_CORPUS_WITNESS_MISSING"
  | "PCR_CORPUS_SPLIT_LEAKAGE"
  | "PCR_CORPUS_REAL_TRACES_MISSING"
  | "PCR_CORPUS_A1_SHAPE_INVALID";

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

export function failTemplateDuplicate(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_TEMPLATE_DUPLICATE", details);
}

export function failWitnessMissing(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_WITNESS_MISSING", details);
}

export function failSplitLeakage(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_SPLIT_LEAKAGE", details);
}

export function failRealTracesMissing(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_REAL_TRACES_MISSING", details);
}

export function failA1ShapeInvalid(details: Record<string, unknown> = {}): never {
  throw new CorpusGovernorError("PCR_CORPUS_A1_SHAPE_INVALID", details);
}
