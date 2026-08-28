import type { Oracle, OracleItem, RawTrace, RawTraceEntry } from "../../benchmark-contracts/src/index.js";

export type OracleItemKind = "constraint" | "outcome" | "secret" | "directive" | "claim" | string;

export interface OracleValidationError {
  readonly code: string;
  readonly message: string;
  readonly itemId?: string;
}

export interface OracleValidationReport {
  ok: boolean;
  errors: readonly OracleValidationError[];
  resolvedSourceHashes: Readonly<Record<string, string>>;
}

interface ItemExt extends OracleItem {
  readonly quote?: string;
}

function entryText(entry: RawTraceEntry): string {
  return typeof entry.text === "string" ? entry.text : "";
}

function hasCycle(items: readonly OracleItem[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item.supersededBy]));
  for (const item of items) {
    const seen = new Set<string>();
    let current: string | null = item.id;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = byId.get(current) ?? null;
    }
  }
  return false;
}

export function validateOracle(oracle: Oracle, trace: RawTrace): OracleValidationReport {
  const errors: OracleValidationError[] = [];
  const byEntry = new Map(trace.entries.map((entry) => [entry.entryId, entry]));
  const resolvedSourceHashes: Record<string, string> = {};

  for (const entry of trace.entries) {
    resolvedSourceHashes[entry.entryId] = entry.contentSha256;
  }

  for (const item of oracle.items as readonly ItemExt[]) {
    for (const ref of item.sourceRefs) {
      const source = byEntry.get(ref);
      if (!source) {
        errors.push({ code: "SOURCE_NOT_FOUND", message: `missing source ${ref}`, itemId: item.id });
        continue;
      }
      if (item.risk === "hard-directive") {
        const quote = item.quote ?? (typeof item.canonical === "string" ? item.canonical : "");
        const haystack = entryText(source);
        if (quote && !haystack.includes(quote)) {
          errors.push({ code: "SOURCE_QUOTE_MISMATCH", message: `quote not in ${ref}`, itemId: item.id });
        }
        if (source.role !== "user") {
          errors.push({ code: "SOURCE_NOT_AUTHENTICATED_USER", message: `hard directive source ${ref} is ${source.role}`, itemId: item.id });
        }
      }
    }

    if (item.risk === "high-risk-outcome") {
      const attested = item.sourceRefs.some((ref) => {
        const source = byEntry.get(ref);
        return source?.role === "toolResult";
      });
      if (!attested) {
        errors.push({ code: "OUTCOME_NOT_ATTESTED", message: "high-risk outcome requires tool evidence", itemId: item.id });
      }
    }
  }

  if (hasCycle(oracle.items)) {
    errors.push({ code: "SUPERSESSION_CYCLE", message: "supersession graph is cyclic" });
  }

  const active = oracle.items.filter((item) => item.status === "active" && item.supersededBy === null);
  const byKind = new Map<string, OracleItem[]>();
  for (const item of active) {
    const key = `${item.kind}:${item.polarity}`;
    const group = byKind.get(key) ?? [];
    group.push(item);
    byKind.set(key, group);
  }
  for (const group of byKind.values()) {
    const values = new Set(group.map((item) => JSON.stringify(item.canonical)));
    if (values.size > 1 && group.every((item) => item.status !== "contested")) {
      errors.push({ code: "ACTIVE_CONFLICT", message: "active keys have conflicting values" });
    }
  }

  const omitValues = oracle.items
    .filter((item) => item.visibility === "must-omit")
    .map((item) => String(item.canonical));
  for (const assertion of oracle.environmentAssertions) {
    const expected = assertion.expectedAnswer;
    if (typeof expected === "string" && omitValues.includes(expected)) {
      errors.push({ code: "MUST_OMIT_IN_PROBE", message: "must-omit value leaked into probe expected answer" });
    }
  }

  return { ok: errors.length === 0, errors, resolvedSourceHashes };
}
