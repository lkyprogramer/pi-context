import { estimateTextTokens, twoRunHash, verifyHardGates, type CheckpointRenderer, type CheckpointVerifier, type ToolPairMessage } from "@pcr/core";
import type { HostCheckpointDetails, RuntimeCursor } from "@pcr/contracts";

import type { CompactionSnapshotAssembler } from "./compaction/snapshot.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASONS = new Set(["threshold", "overflow", "manual"]);

export interface CompactionPrepareRequest {
  operationId: string;
  cursor: RuntimeCursor;
  reason: "threshold" | "overflow" | "manual";
  now: number;
  tokensBefore: number;
  firstKeptEntryId: string;
  messagesToSummarize?: unknown[];
  retainedTailTokens?: number;
  signal?: AbortSignal;
}

export function collectCompactionSourceTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const texts: string[] = [];
  for (const item of messages) {
    if (typeof item === "string" && item.trim().length > 0) {
      texts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as { text?: unknown; content?: unknown };
    if (typeof record.text === "string" && record.text.trim().length > 0) texts.push(record.text);
    if (typeof record.content === "string" && record.content.trim().length > 0) texts.push(record.content);
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        if (typeof block === "string" && block.trim().length > 0) texts.push(block);
        else if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          const text = (block as { text: string }).text;
          if (text.trim().length > 0) texts.push(text);
        }
      }
    }
  }
  return texts;
}

export function sourceTextsLookConstrained(texts: readonly string[]): boolean {
  return texts.some((text) => (
    /不要|(?:\bdo not\b|\bdon't\b|\bnever\b)|改为|\binstead\b|\bmust\b|必须/iu.test(text)
  ));
}

export interface CompactionReadyResult {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  details: HostCheckpointDetails;
}

export type CompactionDecision =
  | { kind: "pcr"; result: CompactionReadyResult }
  | { kind: "native-fallback" }
  | { kind: "hard-stop"; code: string };

export interface CompactionService {
  prepareCompaction(input: CompactionPrepareRequest): Promise<CompactionDecision>;
}

export interface CreateCompactionServiceInput {
  cursor: RuntimeCursor;
  assembler: CompactionSnapshotAssembler;
  renderer: CheckpointRenderer;
  verifier: CheckpointVerifier;
}

export type CompactionServiceErrorCode =
  | "PCR_COMPACTION_DEPENDENCY_MISSING"
  | "PCR_COMPACTION_INPUT_INVALID"
  | "PCR_COMPACTION_SCOPE_MISMATCH";

export class CompactionServiceError extends TypeError {
  readonly code: CompactionServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CompactionServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CompactionServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CompactionServiceError("PCR_COMPACTION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CompactionServiceError("PCR_COMPACTION_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
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

function requireFunction(value: unknown, dependency: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") failMissing(dependency);
}

function mapAssemblerError(error: unknown): never {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code.endsWith("SCOPE_MISMATCH")) {
      throw new CompactionServiceError("PCR_COMPACTION_SCOPE_MISMATCH");
    }
    if (error.code.endsWith("INPUT_INVALID")) {
      throw new CompactionServiceError("PCR_COMPACTION_INPUT_INVALID", { field: error.code });
    }
  }
  throw error;
}

function toolPairMessages(value: unknown): ToolPairMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as ToolPairMessage;
    if (typeof record.role !== "string") return [];
    return [record];
  });
}

export function uniqueShortRefs(values: readonly string[], minLength = 12): Map<string, string> {
  const unique = [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
  let length = minLength;
  while (length <= 64) {
    const assigned = new Map<string, string>();
    const used = new Set<string>();
    let collision = false;
    for (const value of unique) {
      const short = value.length <= length ? value : value.slice(0, length);
      if (used.has(short)) {
        collision = true;
        break;
      }
      used.add(short);
      assigned.set(value, short);
    }
    if (!collision) {
      const out = new Map<string, string>();
      for (const value of values) {
        if (typeof value === "string" && value.length > 0) out.set(value, assigned.get(value) ?? value);
      }
      return out;
    }
    length += 4;
  }
  return new Map(unique.map((value) => [value, value]));
}

export function renderModelCheckpointView(
  checkpoint: {
    snapshotHash: string;
    directives: ReadonlyArray<{
      directiveId: string;
      exactQuote: string;
      kind: string;
      polarity: string;
      status: string;
    }>;
    claims: ReadonlyArray<{ claimId: string; key: string; polarity: string; status: string; value: unknown }>;
    pointers: ReadonlyArray<{ ref: string; kind: string }>;
    heads: Record<string, string>;
    continuity: { revisionId: string; contentHash?: string };
  },
  options: { includeMetadata?: boolean } = {},
): { summary: string; shortRefs: Record<string, string> } {
  const includeMetadata = options.includeMetadata === true;
  const refValues = [
    checkpoint.snapshotHash,
    checkpoint.continuity.revisionId,
    ...checkpoint.directives.map((item) => item.directiveId),
    ...checkpoint.pointers.map((item) => item.ref),
  ];
  const refs = uniqueShortRefs(refValues);
  const shortOf = (value: string): string => (includeMetadata ? value : (refs.get(value) ?? value.slice(0, 12)));
  const summary = [
    `checkpoint v2 ${shortOf(checkpoint.snapshotHash)}`,
    ...checkpoint.directives.map((item) => `- [${shortOf(item.directiveId)}] ${item.exactQuote}`),
    `continuity ${shortOf(checkpoint.continuity.revisionId)}`,
    ...checkpoint.claims.map((item) => `- ${item.key}=${String(item.value)}`),
    ...checkpoint.pointers.map((item) => `- ${item.kind}:${shortOf(item.ref)}`),
  ].join("\n");
  const shortRefs: Record<string, string> = {};
  for (const [full, short] of refs) shortRefs[full] = short;
  return { summary, shortRefs };
}

export function createCompactionService(input: CreateCompactionServiceInput): CompactionService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.assembler || typeof input.assembler !== "object") failMissing("assembler");
  requireFunction(input.assembler.assemble, "assembler.assemble");
  if (!input.renderer || typeof input.renderer !== "object") failMissing("renderer");
  requireFunction(input.renderer.render, "renderer.render");
  if (!input.verifier || typeof input.verifier !== "object") failMissing("verifier");
  requireFunction(input.verifier.verify, "verifier.verify");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const assembler = input.assembler;
  const renderer = input.renderer;
  const verifier = input.verifier;

  return {
    async prepareCompaction(request: CompactionPrepareRequest): Promise<CompactionDecision> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.operationId, "request.operationId");
      requireNonEmpty(request.firstKeptEntryId, "request.firstKeptEntryId");
      if (typeof request.reason !== "string" || !REASONS.has(request.reason)) failInput("request.reason");
      if (typeof request.now !== "number" || !Number.isFinite(request.now)) failInput("request.now");
      if (typeof request.tokensBefore !== "number" || !Number.isFinite(request.tokensBefore) || request.tokensBefore < 0) {
        failInput("request.tokensBefore");
      }
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) throw new CompactionServiceError("PCR_COMPACTION_SCOPE_MISMATCH");
      request.signal?.throwIfAborted();
      let snapshot;
      try {
        snapshot = await assembler.assemble({
          operationId: request.operationId,
          cursor,
          reason: request.reason,
          now: request.now,
          signal: request.signal,
        });
      } catch (error) {
        mapAssemblerError(error);
      }
      request.signal?.throwIfAborted();
      const pairMessages = toolPairMessages(request.messagesToSummarize);
      const hardGate = verifyHardGates({
        messages: pairMessages,
        firstKeptId: request.firstKeptEntryId,
        payload: {
          snapshotHash: snapshot.snapshotHash,
          firstKeptEntryId: request.firstKeptEntryId,
          pointers: snapshot.pointers,
        },
      });
      if (!hardGate.toolPairOk) {
        return { kind: "hard-stop", code: "PCR_HARD_GATE_TOOL_PAIR" };
      }
      const keptIndex = pairMessages.findIndex((item) => (
        item.hostMessageId === request.firstKeptEntryId || item.id === request.firstKeptEntryId
      ));
      if (keptIndex >= 0) {
        const kept = pairMessages[keptIndex]!;
        const isResult = kept.role === "toolResult" || kept.role === "tool-result";
        if (isResult) {
          return { kind: "hard-stop", code: "PCR_HARD_GATE_BROKEN_TAIL" };
        }
      }
      const checkpoint = await renderer.render(snapshot, request.signal);
      const secondCheckpoint = await renderer.render(snapshot, request.signal);
      if (twoRunHash(checkpoint) !== twoRunHash(secondCheckpoint)) {
        return { kind: "hard-stop", code: "PCR_HARD_GATE_HASH_DRIFT" };
      }
      const report = await verifier.verify(snapshot, checkpoint, request.signal);
      if (!report.ok) {
        return { kind: "hard-stop", code: report.issues[0]?.code ?? "PCR_CHECKPOINT_VERIFY_FAILED" };
      }
      const view = renderModelCheckpointView({
        snapshotHash: checkpoint.snapshotHash,
        directives: checkpoint.directives,
        claims: checkpoint.claims as Array<{ claimId: string; key: string; polarity: string; status: string; value: unknown }>,
        pointers: checkpoint.pointers as Array<{ ref: string; kind: string }>,
        heads: checkpoint.heads as Record<string, string>,
        continuity: checkpoint.continuity as { revisionId: string; contentHash?: string },
      });
      const sourceTexts = collectCompactionSourceTexts(request.messagesToSummarize);
      if (snapshot.directives.length === 0 && sourceTextsLookConstrained(sourceTexts)) {
        return { kind: "native-fallback" };
      }
      const estimatedTokensAfter = estimateTextTokens(view.summary);
      const retainedTailTokens = request.retainedTailTokens ?? 0;
      if (typeof retainedTailTokens !== "number" || !Number.isFinite(retainedTailTokens) || retainedTailTokens < 0) {
        failInput("request.retainedTailTokens");
      }
      if (!(estimatedTokensAfter + retainedTailTokens < request.tokensBefore)) return { kind: "native-fallback" };
      return {
        kind: "pcr",
        result: {
          firstKeptEntryId: request.firstKeptEntryId,
          summary: view.summary,
          tokensBefore: request.tokensBefore,
          estimatedTokensAfter,
          details: {
            schemaVersion: 1,
            directiveHead: snapshot.heads.directiveHead,
            claimHead: snapshot.heads.claimHead,
            continuityHead: snapshot.heads.continuityHead,
            catalogHead: snapshot.heads.catalogHead,
            outputHash: report.outputHash,
            reducerRevisions: [
              `snapshot:${checkpoint.snapshotHash}`,
              `hard-gate:toolPairOk=${hardGate.toolPairOk}`,
              `hard-gate:outputHash=${hardGate.outputHash}`,
              `hard-gate:secondRunHash=${hardGate.secondRunHash}`,
              `hard-gate:retainedTail=${hardGate.retainedTailIds.join(",")}`,
              ...checkpoint.pointers.map((item) => `pointer:${String((item as { kind?: string }).kind ?? "blob")}:${String((item as { ref?: string }).ref ?? "")}`),
            ],
          },
        },
      };
    },
  };
}
