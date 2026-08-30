import { failInput, failMissing, failScope } from "./errors.js";
import type {
  Oracle,
  OracleItem,
  OracleValidationReport,
  RawTrace,
  RawTraceEntry,
  RawTraceRole,
} from "./types.js";

const ROLES = new Set<RawTraceRole>(["user", "assistant", "toolResult"]);
const DEFAULT_WITNESS_ROLES = new Set<RawTraceRole>(["user", "toolResult"]);

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function optionalScope(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  requireNonEmpty(value, field);
  return value;
}

function snapshotItem(value: unknown, field: string): OracleItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput(field);
  const item = value as OracleItem;
  requireNonEmpty(item.id, `${field}.id`);
  requireNonEmpty(item.key, `${field}.key`);
  requireNonEmpty(item.expected, `${field}.expected`);
  if (item.sourceRefs !== undefined) {
    if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) failInput(`${field}.sourceRefs`);
    item.sourceRefs.forEach((ref, index) => requireNonEmpty(ref, `${field}.sourceRefs[${index}]`));
  }
  return {
    id: item.id,
    key: item.key,
    expected: item.expected,
    ...(item.sourceRefs ? { sourceRefs: [...item.sourceRefs] } : {}),
  };
}

function snapshotOracle(oracle: unknown): Oracle {
  if (!oracle || typeof oracle !== "object") failMissing("oracle");
  const value = oracle as Oracle;
  if (!Array.isArray(value.items) || value.items.length === 0) failInput("oracle.items");
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) failInput("oracle.signal");
  const seen = new Set<string>();
  const items = value.items.map((item, index) => {
    const next = snapshotItem(item, `oracle.items[${index}]`);
    if (seen.has(next.id)) failInput("oracle.items.id");
    seen.add(next.id);
    return next;
  });
  return {
    items,
    workspaceId: optionalScope(value.workspaceId, "oracle.workspaceId"),
    sessionId: optionalScope(value.sessionId, "oracle.sessionId"),
    signal: value.signal,
  };
}

function snapshotEntry(value: unknown, field: string): RawTraceEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput(field);
  const entry = value as RawTraceEntry;
  requireNonEmpty(entry.entryId, `${field}.entryId`);
  if (typeof entry.role !== "string" || !ROLES.has(entry.role)) failInput(`${field}.role`);
  if (typeof entry.text !== "string") failInput(`${field}.text`);
  return {
    entryId: entry.entryId,
    role: entry.role,
    text: entry.text,
    workspaceId: optionalScope(entry.workspaceId, `${field}.workspaceId`),
    sessionId: optionalScope(entry.sessionId, `${field}.sessionId`),
  };
}

function inScope(oracle: Oracle, candidate: { workspaceId?: string; sessionId?: string }): boolean {
  if (oracle.workspaceId && candidate.workspaceId && oracle.workspaceId !== candidate.workspaceId) return false;
  if (oracle.sessionId && candidate.sessionId && oracle.sessionId !== candidate.sessionId) return false;
  return true;
}

function reportOk(): OracleValidationReport {
  return Object.freeze({ ok: true });
}

function reportUnsupported(itemId: string): OracleValidationReport {
  return Object.freeze({
    ok: false,
    code: "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS",
    itemId,
  });
}

function witnessesFor(item: OracleItem, entries: readonly RawTraceEntry[], oracle: Oracle): RawTraceEntry[] {
  if (!item.sourceRefs) {
    return entries.filter((entry) => DEFAULT_WITNESS_ROLES.has(entry.role) && inScope(oracle, entry));
  }
  const byId = new Map(entries.map((entry) => [entry.entryId, entry]));
  return item.sourceRefs.map((ref) => {
    const entry = byId.get(ref);
    if (!entry) failInput(`sourceRefs.${ref}`);
    if (!inScope(oracle, entry)) failScope({ sourceRef: ref, workspaceId: entry.workspaceId, sessionId: entry.sessionId });
    return entry;
  });
}

export function validateOracle(trace: RawTrace, oracle: Oracle): OracleValidationReport {
  if (trace === undefined || trace === null) failMissing("trace");
  const snapshot = snapshotOracle(oracle);
  snapshot.signal?.throwIfAborted();
  if (!trace || typeof trace !== "object") failMissing("trace");
  if (snapshot.workspaceId && trace.workspaceId && snapshot.workspaceId !== trace.workspaceId) {
    failScope({ expected: snapshot.workspaceId, actual: trace.workspaceId });
  }
  if (snapshot.sessionId && trace.sessionId && snapshot.sessionId !== trace.sessionId) {
    failScope({ expected: snapshot.sessionId, actual: trace.sessionId });
  }
  if (!Array.isArray(trace.entries) || trace.entries.length === 0) failInput("trace.entries");
  const seen = new Set<string>();
  const entries = trace.entries.map((entry, index) => {
    const next = snapshotEntry(entry, `trace.entries[${index}]`);
    if (seen.has(next.entryId)) failInput("trace.entries.entryId");
    seen.add(next.entryId);
    return next;
  });
  for (const item of snapshot.items) {
    const witnesses = witnessesFor(item, entries, snapshot);
    if (!witnesses.some((entry) => entry.text.includes(item.expected))) {
      return reportUnsupported(item.id);
    }
  }
  return reportOk();
}
