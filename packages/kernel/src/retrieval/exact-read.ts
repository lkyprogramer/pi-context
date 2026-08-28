export interface ExactReadRequest {
  cursor: { workspaceId: string; sessionId?: string };
  range?: { start: number; end: number };
  maxBytes: number;
  allowSecrets?: boolean;
}

export interface ExactReadDescriptor {
  workspaceId: string;
  contentHash: string;
  rawBlobId?: string;
}

export interface ExactReadDeps {
  store: { getEvidence(id: string): Promise<ExactReadDescriptor | null> };
  blobs: {
    read(blobId: string): Promise<Uint8Array>;
    verify(blobId: string, plain: Uint8Array): Promise<void>;
  };
}

export interface ExactReadResult {
  bytes: Buffer;
  truncated: boolean;
  unavailable?: boolean;
  receipt: { evidenceId: string; bytes: number; redacted: boolean };
}

function scopedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function sliceUtf8(plain: Uint8Array, start: number, end: number): Buffer {
  let from = Math.max(0, start);
  let to = Math.min(plain.byteLength, end);
  while (from < to && (plain[from] & 0b1100_0000) === 0b1000_0000) from += 1;
  while (to > from && (plain[to] & 0b1100_0000) === 0b1000_0000) to -= 1;
  return Buffer.from(plain.subarray(from, to));
}

export function applyReadBudget(plain: Uint8Array, range: ExactReadRequest["range"], maxBytes: number): { bytes: Buffer; truncated: boolean } {
  const start = range?.start ?? 0;
  const end = range?.end ?? plain.byteLength;
  if (start < 0 || end < start) throw scopedError("PCR_INVALID_RANGE");
  const sliced = sliceUtf8(plain, start, end);
  if (sliced.byteLength <= maxBytes) return { bytes: sliced, truncated: sliced.byteLength < end - start };
  return { bytes: sliceUtf8(sliced, 0, maxBytes), truncated: true };
}

export async function readEvidenceById(id: string, request: ExactReadRequest, deps: ExactReadDeps): Promise<ExactReadResult> {
  const descriptor = await deps.store.getEvidence(id);
  if (!descriptor || descriptor.workspaceId !== request.cursor.workspaceId) {
    throw scopedError("PCR_RETRIEVAL_SCOPE_DENIED");
  }
  if (!descriptor.rawBlobId) throw scopedError("PCR_POINTER_UNAVAILABLE");
  let plain: Uint8Array;
  try {
    plain = await deps.blobs.read(descriptor.rawBlobId);
    await deps.blobs.verify(descriptor.rawBlobId, plain);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "PCR_BLOB_NOT_FOUND" || code === "ENOENT") throw scopedError("PCR_POINTER_UNAVAILABLE");
    throw error;
  }
  const text = Buffer.from(plain).toString("utf8");
  const secret = /api[_-]?key|secret|password/i.test(text);
  if (secret && request.allowSecrets !== true) {
    const redacted = Buffer.from("[redacted]");
    return {
      bytes: redacted,
      truncated: true,
      receipt: { evidenceId: id, bytes: redacted.byteLength, redacted: true },
    };
  }
  const bounded = applyReadBudget(plain, request.range, request.maxBytes);
  return {
    ...bounded,
    receipt: { evidenceId: id, bytes: bounded.bytes.byteLength, redacted: false },
  };
}
