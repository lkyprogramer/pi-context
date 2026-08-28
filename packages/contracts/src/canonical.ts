import { pcrError } from "./errors.js";

function assertCanonicalScalar(value: unknown): void {
  if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw pcrError("UNKNOWN_ENUM", { reason: "non-canonical" });
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw pcrError("UNKNOWN_ENUM", { reason: "non-canonical-number" });
  }
}

export function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  assertCanonicalScalar(value);
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (seen.has(value)) {
    throw pcrError("UNKNOWN_ENUM", { reason: "cyclic" });
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, seen)}`).join(",")}}`;
}
