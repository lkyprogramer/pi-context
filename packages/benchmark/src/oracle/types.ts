export type RawTraceRole = "user" | "assistant" | "toolResult";

export interface RawTraceEntry {
  entryId: string;
  role: RawTraceRole;
  text: string;
  workspaceId?: string;
  sessionId?: string;
}

export interface RawTrace {
  entries: readonly RawTraceEntry[];
  workspaceId?: string;
  sessionId?: string;
}

export interface OracleItem {
  id: string;
  key: string;
  expected: string;
  sourceRefs?: readonly string[];
}

export interface Oracle {
  items: readonly OracleItem[];
  workspaceId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export type OracleValidationCode = "ORACLE_VALUE_UNSUPPORTED_BY_WITNESS";

export interface OracleValidationReport {
  ok: boolean;
  code?: OracleValidationCode;
  itemId?: string;
}
