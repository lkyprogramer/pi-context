import type { ActionAuthority, SourceClass } from "./types.js";
import type { RuntimeCursor } from "./identity.js";

export interface TextRange {
  start: number;
  end: number;
}

export interface UserTurnRecord {
  userTurnId: string;
  cursor: RuntimeCursor;
  rawTextHash: string;
  rawBlobId: string;
  utf8Bytes: number;
  hostMessageId?: string;
  sourceClass: "authenticated-user" | "untrusted-user";
  capturedAt: number;
}

export type CanonicalDirectiveKind =
  | "goal"
  | "constraint"
  | "prohibition"
  | "correction"
  | "permission"
  | "format";
export type CanonicalDirectivePolarity = "must" | "must-not" | "may" | "is" | "is-not" | "unknown";
export type CanonicalDirectiveStatus = "active" | "superseded" | "resolved" | "retracted" | "contested";

export interface DirectiveRecord {
  directiveId: string;
  userTurnId: string;
  exactQuote: string;
  quoteHash: string;
  utf8ByteRange: TextRange;
  utf16Range: TextRange;
  codePointRange: TextRange;
  kind: CanonicalDirectiveKind;
  polarity: CanonicalDirectivePolarity;
  key?: string;
  value?: string;
  status: CanonicalDirectiveStatus;
  supersededBy?: string;
}

export interface EvidenceReceipt {
  evidenceId: string;
  cursor: RuntimeCursor;
  sourceClass: SourceClass;
  authority: ActionAuthority;
  contentHash: string;
  blobId: string;
  observedAt: number;
}

export interface CheckpointV2 {
  version: 2;
  snapshotHash: string;
  directives: DirectiveRecord[];
  continuity: Record<string, unknown>;
  claims: Record<string, unknown>[];
  pointers: Record<string, unknown>[];
  heads: Record<string, string>;
}

export interface RuntimeConfigV2 {
  dataRoot: string;
  ingress: Record<string, unknown>;
  materialization: Record<string, unknown>;
  compaction: Record<string, unknown>;
  retrieval: Record<string, unknown>;
  semantic: Record<string, unknown>;
}
