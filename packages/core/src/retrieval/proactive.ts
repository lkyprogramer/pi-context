import { domainHash, type ActionAuthority, type RuntimeCursor, type TaskFrontStatus } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TASK_STATUSES = new Set<TaskFrontStatus>(["active", "parked", "completed", "superseded"]);

export interface RecallHit {
  evidenceId: string;
  quote: string;
  tokens?: number;
}

export interface RecallCatalog {
  search(query: { cursor: RuntimeCursor; text: string; signal?: AbortSignal }): Promise<readonly RecallHit[]>;
}

export interface RecallLease {
  leaseId: string;
  pageId: string;
  purpose: string;
  authority: Extract<ActionAuthority, "inform">;
  turns: number;
  tokenTurns: number;
  expiresAt: number;
}

export interface RecallLeasePort {
  grant(input: {
    cursor: RuntimeCursor;
    pageId: string;
    purpose: string;
    requestedAuthority?: ActionAuthority;
    signal?: AbortSignal;
  }): Promise<RecallLease>;
}

export interface RecallDecisionInput {
  cursor: RuntimeCursor;
  userText: string;
  activePaths?: readonly string[];
  errorIds?: readonly string[];
  directives?: ReadonlyArray<{ quote: string; kind?: string }>;
  recentlyInjected?: readonly string[];
  maxTokens: number;
  taskStatus?: TaskFrontStatus;
  signal?: AbortSignal;
}

export interface RecallPageItem {
  evidenceId: string;
  quote: string;
  tokens: number;
  required?: boolean;
}

export interface RecallPage {
  items: RecallPageItem[];
  omitted: Array<{ evidenceId: string; reason: string }>;
  query: { text: string };
  abstained?: boolean;
}

export type RecallDecision =
  | { kind: "needed"; page: RecallPage; lease: RecallLease }
  | { kind: "not-needed"; reason: "empty" | "task-completed"; page: RecallPage };

export interface ProactiveRecallPolicy {
  decide(input: RecallDecisionInput): Promise<RecallDecision>;
}

export interface CreateProactiveRecallPolicyInput {
  cursor: RuntimeCursor;
  catalog: RecallCatalog;
  leases: RecallLeasePort;
}

export type RecallErrorCode =
  | "PCR_RECALL_DEPENDENCY_MISSING"
  | "PCR_RECALL_INPUT_INVALID"
  | "PCR_RECALL_SCOPE_MISMATCH";

export class RecallError extends TypeError {
  readonly code: RecallErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RecallErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RecallError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new RecallError("PCR_RECALL_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new RecallError("PCR_RECALL_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function snapshotRecallCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function tokenEstimate(quote: string, explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit <= 0) failInput("hit.tokens");
    return explicit;
  }
  return Math.max(8, Math.ceil(quote.length / 4));
}

function deriveQueryText(input: RecallDecisionInput): string {
  return [
    input.userText,
    ...(input.activePaths ?? []),
    ...(input.errorIds ?? []),
    ...(input.directives ?? []).map((item) => item.quote),
  ].join(" ").trim();
}

function selectUnderBudget(items: RecallPageItem[], maxTokens: number): { selected: RecallPageItem[]; omitted: Array<{ evidenceId: string; reason: string }> } {
  const selected: RecallPageItem[] = [];
  let used = 0;
  const omitted: Array<{ evidenceId: string; reason: string }> = [];
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  for (const item of [...required, ...optional]) {
    if (!item.required && used + item.tokens > maxTokens) {
      omitted.push({ evidenceId: item.evidenceId, reason: "budget" });
      continue;
    }
    selected.push(item);
    used += item.tokens;
  }
  return { selected, omitted };
}

export function createProactiveRecallPolicy(input: CreateProactiveRecallPolicyInput): ProactiveRecallPolicy {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.catalog || typeof input.catalog.search !== "function") failMissing("catalog");
  if (!input.leases || typeof input.leases.grant !== "function") failMissing("leases");
  const bound = snapshotRecallCursor(input.cursor, "input.cursor");
  const catalog = input.catalog;
  const leases = input.leases;

  return {
    async decide(event: RecallDecisionInput): Promise<RecallDecision> {
      if (!event || typeof event !== "object") failInput("event");
      if (event.signal !== undefined && !(event.signal instanceof AbortSignal)) failInput("event.signal");
      event.signal?.throwIfAborted();
      const cursor = snapshotRecallCursor(event.cursor, "event.cursor");
      if (!sameCursor(bound, cursor)) throw new RecallError("PCR_RECALL_SCOPE_MISMATCH");
      requireNonEmpty(event.userText, "event.userText");
      if (!Number.isInteger(event.maxTokens) || event.maxTokens <= 0) failInput("event.maxTokens");
      if (event.taskStatus !== undefined && (typeof event.taskStatus !== "string" || !TASK_STATUSES.has(event.taskStatus))) {
        failInput("event.taskStatus");
      }
      const queryText = deriveQueryText(event);
      const emptyPage = (reason: "empty" | "task-completed"): RecallDecision => ({
        kind: "not-needed",
        reason,
        page: { items: [], omitted: [], query: { text: queryText }, abstained: true },
      });
      if (event.taskStatus === "completed" || event.taskStatus === "superseded") return emptyPage("task-completed");
      event.signal?.throwIfAborted();
      const hits = await catalog.search({ cursor, text: queryText, signal: event.signal });
      if (!Array.isArray(hits)) failInput("catalog.search");
      event.signal?.throwIfAborted();
      const recent = new Set(event.recentlyInjected ?? []);
      const merged: RecallPageItem[] = [];
      const seenQuotes = new Set<string>();
      const seenIds = new Set<string>();
      for (const hit of hits) {
        if (!hit || typeof hit !== "object") failInput("catalog.search[]");
        requireNonEmpty(hit.evidenceId, "catalog.search[].evidenceId");
        requireNonEmpty(hit.quote, "catalog.search[].quote");
        if (recent.has(hit.evidenceId) || seenIds.has(hit.evidenceId) || seenQuotes.has(hit.quote)) continue;
        seenIds.add(hit.evidenceId);
        seenQuotes.add(hit.quote);
        merged.push({
          evidenceId: hit.evidenceId,
          quote: hit.quote,
          tokens: tokenEstimate(hit.quote, hit.tokens),
        });
      }
      for (const directive of event.directives ?? []) {
        requireNonEmpty(directive.quote, "event.directives[].quote");
        const existing = merged.find((item) => item.quote === directive.quote);
        if (existing) {
          existing.required = true;
          continue;
        }
        const evidenceId = `ev_${domainHash("recall-directive", { quote: directive.quote })}`;
        if (recent.has(evidenceId) || seenIds.has(evidenceId)) continue;
        seenIds.add(evidenceId);
        seenQuotes.add(directive.quote);
        merged.push({
          evidenceId,
          quote: directive.quote,
          tokens: tokenEstimate(directive.quote),
          required: true,
        });
      }
      const { selected, omitted } = selectUnderBudget(merged, event.maxTokens);
      if (selected.length === 0) return emptyPage("empty");
      const pageId = `pg_${domainHash("recall-page", { cursor, text: queryText, maxTokens: event.maxTokens }).slice(0, 24)}`;
      event.signal?.throwIfAborted();
      const lease = await leases.grant({
        cursor,
        pageId,
        purpose: "recall",
        requestedAuthority: "inform",
        signal: event.signal,
      });
      return {
        kind: "needed",
        page: { items: selected, omitted, query: { text: queryText } },
        lease,
      };
    },
  };
}
