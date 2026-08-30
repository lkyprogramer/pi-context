import type { RedactionReport, RedactionReplacement } from "./types.js";

const TOKEN = /\bsk-[A-Za-z0-9-]{8,}\b/gu;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu;
const PATH = /(?:\/Users|\/home)\/[^\s"'\\]+/gu;

export interface RedactionCounts {
  token: number;
  email: number;
  path: number;
}

function countAndReplace(text: string, pattern: RegExp, replacement: string, bump: () => void): string {
  return text.replace(pattern, () => {
    bump();
    return replacement;
  });
}

export function redactString(text: string, counts: RedactionCounts): string {
  let next = countAndReplace(text, TOKEN, "[redacted:token]", () => {
    counts.token += 1;
  });
  next = countAndReplace(next, EMAIL, "[redacted:email]", () => {
    counts.email += 1;
  });
  return countAndReplace(next, PATH, "[redacted:path]", () => {
    counts.path += 1;
  });
}

export function redactValue(value: unknown, counts: RedactionCounts): unknown {
  if (typeof value === "string") return redactString(value, counts);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counts));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, redactValue(item, counts)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function emptyCounts(): RedactionCounts {
  return { token: 0, email: 0, path: 0 };
}

export function toReport(counts: RedactionCounts): RedactionReport {
  const replacements: RedactionReplacement[] = (["email", "path", "token"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => ({ kind, count: counts[kind] }));
  return Object.freeze({ replacements: Object.freeze(replacements) });
}
