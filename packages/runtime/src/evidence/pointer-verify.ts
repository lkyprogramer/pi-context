import { createHash } from "node:crypto";

import type { BlobRef, ByteRange, RuntimeCursor } from "@pcr/contracts";
import type { BlobStore } from "../ports.js";

export const POINTER_BATCH_LIMIT = 256;

export type PointerVerifyReason = "ok" | "missing" | "hash-mismatch" | "corrupt" | "cross-scope" | "range-invalid" | "batch-limit";

export interface PointerVerifyResult {
  ok: boolean;
  sha256: string;
  byteLength: number;
  reason: PointerVerifyReason;
}

export interface PointerBatchReport {
  recoveryRate: number;
  crossScope: number;
  results: PointerVerifyResult[];
}

function codeOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

function reasonFromError(error: unknown): PointerVerifyReason {
  const code = codeOf(error) ?? "";
  if (code.includes("SCOPE")) return "cross-scope";
  if (code.includes("NOT_FOUND") || code.includes("MISSING") || code.includes("ENOENT")) return "missing";
  if (code.includes("RANGE")) return "range-invalid";
  if (code.includes("TAMPER")) return "corrupt";
  return "missing";
}

export async function verifyPointer(input: {
  cursor: RuntimeCursor;
  blobs: BlobStore;
  ref: BlobRef;
  expectedSha256?: string;
  range?: ByteRange;
  signal?: AbortSignal;
}): Promise<PointerVerifyResult> {
  input.signal?.throwIfAborted();
  try {
    const bytes = await input.blobs.read(input.cursor, input.ref, input.range);
    input.signal?.throwIfAborted();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedSha256 && input.expectedSha256 !== sha256) {
      return { ok: false, sha256, byteLength: bytes.byteLength, reason: "hash-mismatch" };
    }
    return { ok: true, sha256, byteLength: bytes.byteLength, reason: "ok" };
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
    return { ok: false, sha256: "", byteLength: 0, reason: reasonFromError(error) };
  }
}

export async function verifyPointerBatch(input: {
  cursor: RuntimeCursor;
  blobs: BlobStore;
  refs: ReadonlyArray<{ ref: BlobRef; expectedSha256?: string; range?: ByteRange }>;
  signal?: AbortSignal;
  limit?: number;
}): Promise<PointerBatchReport> {
  input.signal?.throwIfAborted();
  const limit = input.limit ?? POINTER_BATCH_LIMIT;
  if (input.refs.length > limit) {
    return {
      recoveryRate: 0,
      crossScope: 0,
      results: [{ ok: false, sha256: "", byteLength: 0, reason: "batch-limit" }],
    };
  }
  const results: PointerVerifyResult[] = [];
  for (const item of input.refs) {
    input.signal?.throwIfAborted();
    results.push(await verifyPointer({
      cursor: input.cursor,
      blobs: input.blobs,
      ref: item.ref,
      ...(item.expectedSha256 === undefined ? {} : { expectedSha256: item.expectedSha256 }),
      ...(item.range === undefined ? {} : { range: item.range }),
      signal: input.signal,
    }));
  }
  const recovered = results.filter((item) => item.ok).length;
  const crossScope = results.filter((item) => item.reason === "cross-scope").length;
  return {
    recoveryRate: results.length === 0 ? 1 : recovered / results.length,
    crossScope,
    results,
  };
}

export function createPointerCheck(blobs: BlobStore, limit = POINTER_BATCH_LIMIT): {
  verify(
    cursor: RuntimeCursor,
    pointers: ReadonlyArray<{ ref: string; kind?: string }>,
    signal?: AbortSignal,
  ): Promise<void>;
} {
  return {
    async verify(cursor, pointers, signal) {
      const report = await verifyPointerBatch({
        cursor,
        blobs,
        refs: pointers.map((item) => ({ ref: item.ref as BlobRef })),
        signal,
        limit,
      });
      if (report.results.some((item) => item.reason === "batch-limit")) {
        throw Object.assign(new Error("PCR_POINTER_BATCH_LIMIT"), { code: "PCR_POINTER_BATCH_LIMIT" });
      }
      if (report.crossScope > 0) {
        throw Object.assign(new Error("PCR_POINTER_SCOPE_MISMATCH"), { code: "PCR_POINTER_SCOPE_MISMATCH" });
      }
      if (report.recoveryRate !== 1) {
        const failed = report.results.find((item) => !item.ok);
        const code = failed?.reason === "missing"
          ? "PCR_POINTER_UNAVAILABLE"
          : failed?.reason === "hash-mismatch" || failed?.reason === "corrupt"
            ? "PCR_POINTER_HASH_MISMATCH"
            : "PCR_POINTER_VERIFY_FAILED";
        throw Object.assign(new Error(code), { code });
      }
    },
  };
}
