import { createHash } from "node:crypto";

import {
  domainHash,
  isBlobId,
  type ActionAuthority,
  type HostContentBlock,
  type RuntimeCursor,
} from "@pcr/contracts";

import type { BlobStore, ProjectedToolResult, ToolObservation } from "./ports.js";
import type { SagaJournal } from "./saga/contracts.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_CLASSES = new Set<ToolObservation["sourceClass"]>(["trusted-tool", "untrusted-tool"]);
const AUTHORITIES = new Set<ActionAuthority>(["none", "inform", "propose", "act"]);
const REDUCER = Object.freeze({ id: "default-pointer", revision: "1" });

export interface ObservationService {
  ingest(input: ToolObservation): Promise<ProjectedToolResult>;
  acknowledge(operationId: string, hostMessageId: string): Promise<void>;
}

export interface CreateObservationServiceInput {
  cursor: RuntimeCursor;
  blobs: BlobStore;
  saga: SagaJournal;
}

export type ObservationServiceErrorCode =
  | "PCR_OBSERVATION_DEPENDENCY_MISSING"
  | "PCR_OBSERVATION_INPUT_INVALID"
  | "PCR_OBSERVATION_SCOPE_MISMATCH";

export class ObservationServiceError extends TypeError {
  readonly code: ObservationServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ObservationServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ObservationServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new ObservationServiceError("PCR_OBSERVATION_INPUT_INVALID", { field });
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

function rawToolBytes(content: ToolObservation["content"]): Buffer {
  if (!Array.isArray(content)) failInput("input.content");
  const text = content
    .filter((block): block is Extract<HostContentBlock, { type: "text" }> => (
      !!block && block.type === "text" && typeof block.text === "string"
    ))
    .map((block) => block.text)
    .join("");
  return Buffer.from(text, "utf8");
}

function projectVisible(rawBlobId: string, operationId: string, observationId: string, isError: boolean): ProjectedToolResult {
  return {
    operationId,
    observationId,
    rawBlobId: rawBlobId as ProjectedToolResult["rawBlobId"],
    evidenceIds: [],
    visibleContent: [{ type: "text", text: `[pcr observation pointer] ctx://observation/${rawBlobId}` }],
    isError,
    reducer: { id: REDUCER.id, revision: REDUCER.revision },
  };
}

class DefaultObservationService implements ObservationService {
  readonly #cursor: Readonly<RuntimeCursor>;
  readonly #blobs: BlobStore;
  readonly #saga: SagaJournal;
  readonly #configFingerprint: string;

  constructor(input: CreateObservationServiceInput) {
    if (!input || typeof input !== "object") {
      throw new ObservationServiceError("PCR_OBSERVATION_DEPENDENCY_MISSING", { dependency: "input" });
    }
    if (!input.cursor || typeof input.cursor !== "object") {
      throw new ObservationServiceError("PCR_OBSERVATION_DEPENDENCY_MISSING", { dependency: "cursor" });
    }
    this.#cursor = snapshotCursor(input.cursor, "input.cursor");
    if (!input.blobs || typeof input.blobs.put !== "function" || typeof input.blobs.read !== "function") {
      throw new ObservationServiceError("PCR_OBSERVATION_DEPENDENCY_MISSING", { dependency: "blobs" });
    }
    if (!input.saga || typeof input.saga.prepare !== "function" || typeof input.saga.markHostVisible !== "function") {
      throw new ObservationServiceError("PCR_OBSERVATION_DEPENDENCY_MISSING", { dependency: "saga" });
    }
    this.#blobs = input.blobs;
    this.#saga = input.saga;
    this.#configFingerprint = domainHash("observation-reducer", REDUCER);
  }

  async ingest(value: ToolObservation): Promise<ProjectedToolResult> {
    if (!value || typeof value !== "object") failInput("input");
    const cursor = snapshotCursor(value.cursor, "input.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new ObservationServiceError("PCR_OBSERVATION_SCOPE_MISMATCH");
    }
    requireNonEmpty(value.operationId, "input.operationId");
    requireNonEmpty(value.toolCallId, "input.toolCallId");
    requireNonEmpty(value.toolName, "input.toolName");
    if (!SOURCE_CLASSES.has(value.sourceClass)) failInput("input.sourceClass");
    if (!AUTHORITIES.has(value.authority)) failInput("input.authority");
    if (!Number.isSafeInteger(value.capturedAt) || value.capturedAt < 0) failInput("input.capturedAt");
    if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) failInput("input.signal");
    const bytes = rawToolBytes(value.content);
    const sourceContentHash = createHash("sha256").update(bytes).digest("hex");
    const observationId = `obs_${domainHash("observation-id", {
      operationId: value.operationId,
      toolCallId: value.toolCallId,
      sourceContentHash,
    })}`;
    value.signal?.throwIfAborted();
    const rawBlobId = await this.#blobs.put(cursor, bytes);
    value.signal?.throwIfAborted();
    if (!isBlobId(rawBlobId)) failInput("blobs.put.rawBlobId");
    await this.#saga.prepare({
      operationId: value.operationId,
      cursor,
      kind: "observation",
      sourceContentHash,
      hostCorrelationId: value.toolCallId,
      rawBlobId,
      configFingerprint: this.#configFingerprint,
      ...(value.signal === undefined ? {} : { signal: value.signal }),
    });
    return projectVisible(rawBlobId, value.operationId, observationId, value.isError === true);
  }

  async acknowledge(operationId: string, hostMessageId: string): Promise<void> {
    requireNonEmpty(operationId, "operationId");
    requireNonEmpty(hostMessageId, "hostMessageId");
    await this.#saga.markHostVisible(operationId, hostMessageId);
  }
}

export function createObservationService(input: CreateObservationServiceInput): ObservationService {
  return new DefaultObservationService(input);
}
