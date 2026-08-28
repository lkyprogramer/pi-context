export const PCR_ERROR_CODES = [
  "INVALID_SOURCE_CLASS",
  "AUTHORITY_CEILING_EXCEEDED",
  "INVALID_ID",
  "UNKNOWN_ENUM",
] as const;

export type PcrErrorCode = (typeof PCR_ERROR_CODES)[number];

export interface PcrError {
  readonly name: "PcrError";
  readonly code: PcrErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function pcrError(code: PcrErrorCode, details?: Record<string, unknown>): PcrError {
  return Object.freeze({
    name: "PcrError",
    code,
    ...(details ? { details: Object.freeze({ ...details }) } : {}),
  });
}

export function isPcrError(value: unknown): value is PcrError {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as { name?: unknown; code?: unknown };
  return candidate.name === "PcrError" && PCR_ERROR_CODES.includes(candidate.code as PcrErrorCode);
}
