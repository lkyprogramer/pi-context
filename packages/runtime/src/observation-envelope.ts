import { createHash } from "node:crypto";

import { canonicalJson, type HostContentBlock } from "@pcr/contracts";

export const OBSERVATION_FORMAT = "pcr-observation-v1" as const;
export const DEFAULT_OBSERVATION_VIEW_BUDGET_TOKENS = 500;
const IMAGE_RESERVE_TOKENS = 765;

export interface ObservationEnvelope {
  format: "pcr-observation-v1";
  toolCallId: string;
  toolName: string;
  content: readonly unknown[];
  details: unknown;
  isError: boolean;
}

export type ObservationViewMode = "verbatim" | "reduced" | "bypass";

export interface ObservationView {
  content: readonly unknown[];
  mode: ObservationViewMode;
}

export type ObservationEnvelopeErrorCode =
  | "PCR_OBSERVATION_ENVELOPE_INVALID"
  | "PCR_OBSERVATION_ENVELOPE_NON_CANONICAL";

export class ObservationEnvelopeError extends TypeError {
  readonly code: ObservationEnvelopeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ObservationEnvelopeErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ObservationEnvelopeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const KNOWN_BLOCK_TYPES = new Set([
  "text",
  "image",
  "pointer",
  "image-ref",
  "tool-call-ref",
  "binary",
  "bypass",
]);

function fail(field: string): never {
  throw new ObservationEnvelopeError("PCR_OBSERVATION_ENVELOPE_INVALID", { field });
}

function failCanonical(reason: string): never {
  throw new ObservationEnvelopeError("PCR_OBSERVATION_ENVELOPE_NON_CANONICAL", { reason });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail(field);
}

function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    failCanonical("non-canonical");
  }
  if (typeof value === "number" && !Number.isFinite(value)) failCanonical("non-canonical-number");
  if (value === null || typeof value !== "object") return value;
  if (isBinary(value)) {
    return { type: "binary", encoding: "base64", data: Buffer.from(value).toString("base64") };
  }
  if (seen.has(value)) failCanonical("cyclic");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    record[key] = sanitize(item, seen);
  }
  return record;
}

function assertEnvelope(value: unknown): asserts value is ObservationEnvelope {
  if (!value || typeof value !== "object") fail("envelope");
  const record = value as Record<string, unknown>;
  if (record.format !== OBSERVATION_FORMAT) fail("format");
  requireNonEmpty(record.toolCallId, "toolCallId");
  requireNonEmpty(record.toolName, "toolName");
  if (!Array.isArray(record.content)) fail("content");
  if (typeof record.isError !== "boolean") fail("isError");
}

export function encodeObservation(value: ObservationEnvelope): Uint8Array {
  assertEnvelope(value);
  const sanitized = sanitize({
    content: value.content,
    details: value.details,
    format: OBSERVATION_FORMAT,
    isError: value.isError,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
  }, new WeakSet()) as ObservationEnvelope;
  return Buffer.from(canonicalJson(sanitized), "utf8");
}

export function decodeObservation(bytes: Uint8Array): ObservationEnvelope {
  if (!isBinary(bytes) && !Buffer.isBuffer(bytes)) fail("bytes");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    fail("bytes");
  }
  assertEnvelope(parsed);
  return {
    format: OBSERVATION_FORMAT,
    toolCallId: parsed.toolCallId,
    toolName: parsed.toolName,
    content: parsed.content,
    details: parsed.details,
    isError: parsed.isError,
  };
}

export function tryDecodeObservation(bytes: Uint8Array): ObservationEnvelope | null {
  try {
    return decodeObservation(bytes);
  } catch {
    return null;
  }
}

export function observationEnvelopeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function observationTextFromContent(content: readonly unknown[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const item = block as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("");
}

function isUnknownBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return true;
  const type = (block as { type?: unknown }).type;
  return typeof type !== "string" || !KNOWN_BLOCK_TYPES.has(type);
}

export function toHostVisibleContent(content: readonly unknown[]): HostContentBlock[] {
  const blocks: HostContentBlock[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      blocks.push({ type: "bypass", originalType: "unknown", payload: item, reason: "non-object-block" });
      continue;
    }
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "image" && typeof block.mimeType === "string" && typeof block.data === "string") {
      blocks.push({ type: "image", mimeType: block.mimeType, data: block.data });
      continue;
    }
    if (
      (block.type === "pointer" || block.type === "image-ref" || block.type === "tool-call-ref")
      && typeof block.ref === "string"
      && block.ref.length > 0
    ) {
      blocks.push({ type: block.type, ref: block.ref });
      continue;
    }
    if (block.type === "bypass" && typeof block.reason === "string") {
      blocks.push({
        type: "bypass",
        originalType: typeof block.originalType === "string" ? block.originalType : "unknown",
        payload: block.payload,
        reason: block.reason,
      });
      continue;
    }
    blocks.push({
      type: "bypass",
      originalType: typeof block.type === "string" ? block.type : "unknown",
      payload: item,
      reason: "unsupported-block",
    });
  }
  return blocks;
}

export function renderObservationView(input: {
  original: ObservationEnvelope;
  reducedText: string;
  evidenceId: string;
  budgetTokens: number;
  estimate: (text: string) => number;
}): ObservationView {
  if (!input || typeof input !== "object") fail("input");
  assertEnvelope(input.original);
  if (typeof input.reducedText !== "string") fail("reducedText");
  if (typeof input.evidenceId !== "string") fail("evidenceId");
  if (!Number.isFinite(input.budgetTokens) || input.budgetTokens < 0) fail("budgetTokens");
  if (typeof input.estimate !== "function") fail("estimate");
  const original = input.original;
  if (original.content.some(isUnknownBlock)) {
    return { content: original.content, mode: "bypass" };
  }
  const serialized = canonicalJson(original.content);
  const imageCount = original.content.filter((block) => (
    !!block && typeof block === "object" && (block as { type?: unknown }).type === "image"
  )).length;
  const verbatimCost = input.estimate(serialized) + imageCount * IMAGE_RESERVE_TOKENS;
  const footer = input.evidenceId.length > 0 ? `[pcr-evidence ${input.evidenceId}]` : "";
  const footerCost = footer.length > 0 ? input.estimate(footer) : 0;
  if (verbatimCost + footerCost <= input.budgetTokens) {
    return { content: original.content, mode: "verbatim" };
  }
  const reducedBody = input.reducedText.length > 0 ? input.reducedText : observationTextFromContent(original.content);
  const content: unknown[] = [{ type: "text", text: reducedBody }];
  if (footer.length > 0) content.push({ type: "text", text: footer });
  return { content, mode: "reduced" };
}

export function presentExactObservationPage(input: {
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  range: { start: number; endExclusive: number };
}): { bytes: Uint8Array; kind: "envelope" | "text"; format?: string } {
  const complete = input.range.start === 0 && input.range.endExclusive === input.byteLength;
  if (!complete) return { bytes: input.bytes, kind: "text" };
  const decoded = tryDecodeObservation(input.bytes);
  if (!decoded) return { bytes: input.bytes, kind: "text" };
  return {
    kind: "envelope",
    format: decoded.format,
    bytes: Buffer.from(canonicalJson({
      content: decoded.content,
      envelopeSha256: input.sha256,
      format: decoded.format,
      isError: decoded.isError,
      toolCallId: decoded.toolCallId,
      toolName: decoded.toolName,
    }), "utf8"),
  };
}
