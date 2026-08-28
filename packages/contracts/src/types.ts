import { pcrError, type PcrError } from "./errors.js";

export type SourceClass =
  | "system"
  | "authenticated-user"
  | "untrusted-user"
  | "trusted-tool"
  | "untrusted-tool"
  | "external-content"
  | "agent-derived";

export type ActionAuthority = "none" | "inform" | "propose" | "act";

export const SOURCE_CLASSES: readonly SourceClass[] = [
  "system",
  "authenticated-user",
  "untrusted-user",
  "trusted-tool",
  "untrusted-tool",
  "external-content",
  "agent-derived",
];

const RANK: Record<ActionAuthority, number> = { none: 0, inform: 1, propose: 2, act: 3 };

export const actionAuthorityRank = (value: ActionAuthority): number => RANK[value];

export function sourceAuthorityCeiling(source: SourceClass): ActionAuthority {
  if (source === "system" || source === "authenticated-user" || source === "trusted-tool") return "act";
  if (source === "agent-derived") return "propose";
  if (source === "untrusted-user" || source === "untrusted-tool" || source === "external-content") return "inform";
  return "none";
}

export function parseSourceClass(value: unknown): SourceClass | PcrError {
  if (typeof value === "string" && (SOURCE_CLASSES as readonly string[]).includes(value)) {
    return value as SourceClass;
  }
  return pcrError("INVALID_SOURCE_CLASS", { value });
}

export function derivedAuthorityCeiling(supports: readonly SourceClass[]): ActionAuthority {
  if (supports.length === 0) return "none";
  return supports
    .map(sourceAuthorityCeiling)
    .reduce((lowest, current) => (actionAuthorityRank(current) < actionAuthorityRank(lowest) ? current : lowest));
}

export type CacheZone = "stable-prefix" | "append-only-history" | "volatile-augmentation" | "active-turn";
export type MaterializedSectionKind =
  | "runtime-preamble"
  | "hard-directives"
  | "stable-continuity"
  | "historical-tail"
  | "continuity-delta"
  | "directory"
  | "retrieval-page"
  | "runtime-warning"
  | "active-turn";

export interface HostSessionCursor {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
  thinkingLevel: string;
}

export interface HostTextBlock {
  type: "text";
  text: string;
}
export interface HostPointerBlock {
  type: "pointer";
  ref: string;
}
export interface HostImageRefBlock {
  type: "image-ref";
  ref: string;
}
export interface HostToolCallRefBlock {
  type: "tool-call-ref";
  ref: string;
}
export type HostContentBlock = HostTextBlock | HostPointerBlock | HostImageRefBlock | HostToolCallRefBlock;

export interface HostMessage {
  hostMessageId: string;
  role: "user" | "assistant" | "tool-result" | "custom";
  timestamp: number;
  content: HostContentBlock[];
  sourceClass: SourceClass;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface ObservationInput {
  operationId: string;
  cursor: HostSessionCursor;
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: HostContentBlock[];
  details: unknown;
  isError: boolean;
  capturedAt: number;
}

export interface EvidenceUnit {
  evidenceId: string;
  observationId: string;
  kind: string;
  value: unknown;
  sourceClass: SourceClass;
  authority: ActionAuthority;
  sourceRefs: string[];
  observedAt: number;
  validity: { kind: string; at?: number };
  contentHash?: string;
}

export interface ObservationProjection {
  operationId: string;
  observationId: string;
  rawBlobId: string;
  evidenceIds: string[];
  visibleContent: HostContentBlock[];
  isError: boolean;
  reducer: { id: string; revision: string };
}

export interface MaterializationInput {
  cursor: HostSessionCursor;
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
}

export interface MaterializedSection {
  kind: MaterializedSectionKind;
  cacheZone: CacheZone;
  contentHash: string;
  estimatedTokens: number;
  messageIds: string[];
}

export interface PromptCachePlan {
  layoutVersion: 1;
  sectionOrder: MaterializedSectionKind[];
  eligiblePrefixTokens: number;
  firstDifferentSection: MaterializedSectionKind | null;
  previousViewId: string | null;
  providerCapability: "unknown" | "automatic-prefix" | "explicit-breakpoint" | "disabled";
}

export interface MaterializationOmission {
  kind: string;
  reason: string;
  count: number;
}

export type DirectiveKind =
  | "goal"
  | "constraint"
  | "permission"
  | "prohibition"
  | "format"
  | "correction"
  | "preference"
  | "acceptance-criterion";

export type DirectivePolarity = "must" | "must-not" | "may" | "is" | "is-not" | "unknown";
export type DirectiveStatus = "active" | "superseded" | "resolved" | "retracted" | "contested";

export interface UserDirective {
  directiveId: string;
  workspaceId?: string;
  sessionId?: string;
  sourceInputId: string;
  sourceMessageId: string;
  sourceContentHash: string;
  quote: string;
  byteRange: { start: number; end: number };
  kind: DirectiveKind;
  polarity: DirectivePolarity;
  status: DirectiveStatus;
  scope: { kind: "session" | "task-front" | "artifact" | "tool" | "action"; value: string };
  sourceClass: "authenticated-user";
  authority: "act";
}

export interface MaterializedView {
  viewId: string;
  outputHash: string;
  messages: HostMessage[];
  sections: MaterializedSection[];
  tokenEstimate: number;
  cachePlan: PromptCachePlan;
  omissions: MaterializationOmission[];
}

export type TaskFrontStatus = "active" | "parked" | "completed" | "superseded";
export type SideEffectStatus = "running-unverified" | "verified" | "rolled-back" | "failed";
export type ErrorStage = "observed" | "diagnosed" | "fix-applied" | "revalidated" | "resolved";

export interface TaskFront {
  id: string;
  title: string;
  status: TaskFrontStatus;
  goalClaimId: string;
  evidenceIds: string[];
}

export interface TaskFronts {
  active: TaskFront[];
  parked: TaskFront[];
  completed: TaskFront[];
  superseded: TaskFront[];
}

export interface ErrorState {
  id: string;
  stage: ErrorStage;
  message?: string;
}

export interface SideEffectState {
  id: string;
  kind: string;
  status: SideEffectStatus;
  toolEvidenceId?: string;
}

export interface ValidationState {
  id: string;
  status: "pending" | "passed" | "failed";
  evidenceId?: string;
}

export interface ArtifactState {
  id: string;
  path: string;
}

export interface DelegationState {
  id: string;
  to: string;
}

export interface SafeAction {
  text: string;
  requires: string[];
  forbiddenRepeat?: string[];
}

export interface ContinuityRevision {
  revisionId: string;
  parentRevisionId?: string | null;
  cursor: HostSessionCursor;
  taskFronts: TaskFronts;
  constraints: string[];
  decisions: string[];
  unresolvedErrors: ErrorState[];
  externalSideEffects: SideEffectState[];
  validationState: ValidationState[];
  changedArtifacts: ArtifactState[];
  delegations: DelegationState[];
  nextSafeActions: SafeAction[];
}

export type ContinuityEvent =
  | { type: "user-goal-change"; newGoal: string; evidenceId?: string }
  | { type: "complete-front"; frontId: string; evidenceId: string }
  | { type: "reactivate-front"; frontId: string; evidenceId?: string; sourceClass?: SourceClass }
  | { type: "error-observed"; error: ErrorState }
  | { type: "reword-target"; text: string }
  | { type: "side-effect-update"; id: string; status: SideEffectStatus; toolEvidenceId?: string }
  | { type: "overflow" };

export interface HostCheckpointDirective {
  directiveId: string;
  quote: string;
  polarity?: string;
  status?: string;
}

export interface HostCheckpointClaim {
  claimId: string;
  key: string;
  polarity: string;
  status: string;
  value: unknown;
  validTime?: { start: number; end?: number | null };
}

export interface HostCheckpointPointer {
  ref: string;
  kind: string;
}

export interface HostCheckpointHeads {
  contextHead: string;
  directiveHead: string;
  claimHead: string;
  continuityHead: string;
  catalogHead?: string;
}

export interface HostCheckpoint {
  directives: HostCheckpointDirective[];
  continuity: {
    revisionId: string;
    markdown?: string;
    unresolvedErrors?: ErrorState[];
    externalSideEffects?: SideEffectState[];
  };
  claims: HostCheckpointClaim[];
  pointers: HostCheckpointPointer[];
  heads: HostCheckpointHeads;
  maxCheckpointTokens?: number;
  secrets?: Record<string, string>;
}

export interface HostCheckpointDetails {
  schemaVersion: 1;
  directiveHead: string;
  claimHead: string;
  continuityHead: string;
  catalogHead: string;
  outputHash: string;
  reducerRevisions: string[];
}
