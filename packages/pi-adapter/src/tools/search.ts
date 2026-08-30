import type { RuntimeCursor } from "@pcr/contracts";
import type { EvidenceService, SearchHit } from "@pcr/runtime";

import { objectParameters, type RuntimeTool, type RuntimeToolCtx, type ToolsRuntime } from "./status.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UNSAFE_QUERY = /select\s|drop\s|\/.+\/[gimsuy]*/i;

export interface SearchToolInput {
  query: string;
  limit?: number;
  timeoutMs?: number;
  cursor?: RuntimeCursor;
  signal?: AbortSignal;
}

export interface SearchToolOutput {
  hits: SearchHit[];
  limit: number;
  timeoutMs: number;
}

export interface ReadToolInput {
  evidenceId: string;
  range?: { start: number; endExclusive: number };
  cursor?: RuntimeCursor;
  signal?: AbortSignal;
}

export interface ReadToolOutput {
  evidenceId: string;
  rawBlobId: string;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  range: { start: number; endExclusive: number };
  verified: true;
}

export interface RetrievalToolsPort {
  search(input: SearchToolInput): Promise<SearchToolOutput>;
  read(input: ReadToolInput): Promise<ReadToolOutput>;
}

export interface CreateRetrievalToolsInput {
  cursor: RuntimeCursor;
  evidence: EvidenceService;
}

export type RetrievalToolsErrorCode =
  | "PCR_RETRIEVAL_DEPENDENCY_MISSING"
  | "PCR_RETRIEVAL_INPUT_INVALID"
  | "PCR_RETRIEVAL_SCOPE_DENIED"
  | "PCR_SEARCH_UNSAFE";

export class RetrievalToolsError extends TypeError {
  readonly code: RetrievalToolsErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RetrievalToolsErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RetrievalToolsError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new RetrievalToolsError("PCR_RETRIEVAL_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function snapshotRetrievalCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
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

export function sameRetrievalCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export function requireRetrievalInput(input: CreateRetrievalToolsInput | ToolsRuntime): CreateRetrievalToolsInput {
  if (!input || typeof input !== "object") {
    throw new RetrievalToolsError("PCR_RETRIEVAL_DEPENDENCY_MISSING", { dependency: "input" });
  }
  const candidate = input as CreateRetrievalToolsInput;
  if (!candidate.cursor || typeof candidate.cursor !== "object") {
    throw new RetrievalToolsError("PCR_RETRIEVAL_DEPENDENCY_MISSING", { dependency: "cursor" });
  }
  if (
    !candidate.evidence
    || typeof candidate.evidence.search !== "function"
    || typeof candidate.evidence.read !== "function"
  ) {
    throw new RetrievalToolsError("PCR_RETRIEVAL_DEPENDENCY_MISSING", { dependency: "evidence" });
  }
  return {
    cursor: snapshotRetrievalCursor(candidate.cursor, "input.cursor"),
    evidence: candidate.evidence,
  };
}

export function mapRetrievalScope(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (
    code === "PCR_EVIDENCE_SCOPE_MISMATCH"
    || code === "PCR_EVIDENCE_NOT_FOUND"
    || code === "PCR_RETRIEVAL_SCOPE_DENIED"
  ) {
    throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
  }
  throw error;
}

function boundLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : 5;
  if (!Number.isFinite(numeric)) failInput("limit");
  return Math.min(20, Math.max(1, Math.trunc(numeric)));
}

function boundTimeout(value: unknown): number {
  const numeric = typeof value === "number" ? value : 80;
  if (!Number.isFinite(numeric)) failInput("timeoutMs");
  return Math.min(250, Math.max(10, Math.trunc(numeric)));
}

function assertSafeQuery(query: string): void {
  if (UNSAFE_QUERY.test(query)) {
    throw new RetrievalToolsError("PCR_SEARCH_UNSAFE", { query });
  }
}

export function createRetrievalTools(input: CreateRetrievalToolsInput): RetrievalToolsPort {
  const bound = requireRetrievalInput(input);
  return {
    async search(request: SearchToolInput): Promise<SearchToolOutput> {
      if (!request || typeof request !== "object") failInput("input");
      const query = typeof request.query === "string" ? request.query : "";
      if (!query) failInput("query");
      assertSafeQuery(query);
      const cursor = request.cursor ? snapshotRetrievalCursor(request.cursor, "input.cursor") : bound.cursor;
      if (!sameRetrievalCursor(cursor, bound.cursor)) {
        throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      }
      const limit = boundLimit(request.limit);
      const timeoutMs = boundTimeout(request.timeoutMs);
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      const started = Date.now();
      try {
        const hits = await bound.evidence.search({
          cursor,
          text: query,
          limit,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (Date.now() - started > timeoutMs) return { hits: [], limit, timeoutMs };
        return { hits, limit, timeoutMs };
      } catch (error) {
        mapRetrievalScope(error);
      }
    },
    async read(request: ReadToolInput): Promise<ReadToolOutput> {
      if (!request || typeof request !== "object") failInput("input");
      requireNonEmpty(request.evidenceId, "evidenceId");
      const cursor = request.cursor ? snapshotRetrievalCursor(request.cursor, "input.cursor") : bound.cursor;
      if (!sameRetrievalCursor(cursor, bound.cursor)) {
        throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      }
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      try {
        const page = await bound.evidence.read({
          cursor,
          evidenceId: request.evidenceId,
          ...(request.range === undefined ? {} : { range: request.range }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        return {
          evidenceId: page.evidenceId,
          rawBlobId: page.rawBlobId,
          bytes: page.bytes,
          byteLength: page.byteLength,
          sha256: page.sha256,
          range: page.range,
          verified: true,
        };
      } catch (error) {
        mapRetrievalScope(error);
      }
    },
  };
}

export function createSearchTool(input: CreateRetrievalToolsInput | ToolsRuntime): RuntimeTool {
  const bound = requireRetrievalInput(input);
  const port = createRetrievalTools(bound);
  return {
    name: "context_search",
    label: "Context Search",
    description: "Literal search over scoped evidence snippets. Rejects SQL and regex.",
    parameters: objectParameters(
      {
        query: { type: "string", description: "Literal query" },
        limit: { type: "number", description: "Hit cap, max 20" },
        timeoutMs: { type: "number", description: "Timeout cap, max 250ms" },
      },
      ["query"],
    ),
    async execute(_callId, args, _a, _b, ctx: RuntimeToolCtx | undefined) {
      if (ctx?.workspaceId && ctx.workspaceId !== bound.cursor.workspaceId) {
        throw new RetrievalToolsError("PCR_RETRIEVAL_SCOPE_DENIED");
      }
      const result = await port.search({
        query: String(args.query ?? ""),
        limit: args.limit,
        timeoutMs: args.timeoutMs,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  };
}
