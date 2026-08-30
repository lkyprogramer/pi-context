export type TraceErrorCode =
  | "PCR_TRACE_DEPENDENCY_MISSING"
  | "PCR_TRACE_INPUT_INVALID"
  | "PCR_TRACE_SCOPE_MISMATCH";

export class TraceCaptureError extends TypeError {
  readonly code: TraceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: TraceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "TraceCaptureError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function failMissing(dependency: string): never {
  throw new TraceCaptureError("PCR_TRACE_DEPENDENCY_MISSING", { dependency });
}

export function failInput(field: string): never {
  throw new TraceCaptureError("PCR_TRACE_INPUT_INVALID", { field });
}

export function failScope(details: Record<string, unknown> = {}): never {
  throw new TraceCaptureError("PCR_TRACE_SCOPE_MISMATCH", details);
}
