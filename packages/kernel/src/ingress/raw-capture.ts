import { canonicalJson, domainHash, type ObservationInput } from "../../../contracts/src/index.js";
import type { SagaOperation, SagaPrepareInput } from "../../../storage/src/protocol.js";

export interface CaptureBlobStore {
  put(plain: Uint8Array): Promise<{ blobId: string; bytes: number }>;
  read(blobId: string): Promise<Uint8Array>;
}

export interface CaptureSaga {
  prepare(input: SagaPrepareInput): Promise<SagaOperation>;
}

export interface CaptureDeps {
  blobs: CaptureBlobStore;
  saga: CaptureSaga;
  onEvent?(name: "blob-published" | "receipt-prepared" | "raw-capture-failed"): void;
  profile?: "strict" | "cost";
}

export interface ObservationReceipt extends SagaOperation {
  details: unknown;
  content: ObservationInput["content"];
  rawCaptureUnavailable?: boolean;
}

export function encodeObservationContent(content: ObservationInput["content"], details: unknown): Buffer {
  const text = content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
  return Buffer.from(canonicalJson({ text, content, details }), "utf8");
}

export function decodeObservationText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("utf8");
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // raw text fallback
  }
  return raw;
}

export async function captureObservation(input: ObservationInput, deps: CaptureDeps): Promise<ObservationReceipt> {
  try {
    const bytes = encodeObservationContent(input.content, input.details);
    const blob = await deps.blobs.put(bytes);
    deps.onEvent?.("blob-published");
    const prepared = await deps.saga.prepare({
      operationId: input.operationId,
      kind: "observation",
      cursor: input.cursor,
      sourceContentHash: domainHash("observation", bytes.toString("base64")),
      rawBlobId: blob.blobId,
      hostCorrelationId: input.toolCallId,
    });
    deps.onEvent?.("receipt-prepared");
    return { ...prepared, details: input.details, content: input.content };
  } catch (error) {
    deps.onEvent?.("raw-capture-failed");
    if (deps.profile === "cost") {
      return {
        operationId: input.operationId,
        kind: "observation",
        state: "prepared",
        sourceContentHash: "",
        hostCorrelationId: input.toolCallId,
        branchScope: "main",
        details: input.details,
        content: input.content,
        rawCaptureUnavailable: true,
      };
    }
    throw error;
  }
}
