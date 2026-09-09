// Copied from docs/pi-context-6.1-audit-next-steps/design/proposed-contracts.ts
import type { FieldRef, NativeEntry, Scope } from "../contracts.js";
export interface OutboundMessage {
  role?: string;
  toolCallId?: unknown;
  content?: unknown;
}
export interface ActiveField {
  key: string; // `${entryId}:${blockIndex}`; unique only within the identity below
  ref: FieldRef;
  messageIndex: number;
  blockIndex: number;
  rawText: string;
}
export interface ActiveView {
  scope: Scope;
  branch: readonly NativeEntry[];
  messages: readonly OutboundMessage[];
  fields: readonly ActiveField[];
  compactionBoundary: string | null;
  diagnostics: readonly string[];
}
export interface RequestIdentity {
  workspaceId: string;
  sessionId: string;
  provider: string;
  model: string;
  configHash: string;
  compactionBoundary: string | null;
  epoch: number;
}
export interface WitnessRequest {
  requestId: string;
  identity: RequestIdentity;
  originalFieldHashes: ReadonlyMap<string, string>;
  viewHash: string;
  sentMethod: "provider-payload" | "unavailable";
}
export interface AppliedReceipt {
  requestId: string;
  identity: RequestIdentity;
  planId: string | null;
  appliedKeys: readonly string[];
  beforeHash: string;
  afterHash: string;
  estimatedSavedTokens: number;
  estimateMethod: "character-estimate";
}
export interface SearchPageSnapshot {
  snapshotId: string;
  workspaceId: string;
  sessionId: string;
  anchorEntryId: string;
  queryHash: string;
  configHash: string;
  expiresAt: number;
  refs: readonly FieldRef[];
}
