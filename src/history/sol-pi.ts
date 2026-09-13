import { closeSync, constants, existsSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import {
  estimateTokens,
  sha256Hex,
  utf8Bytes,
  type FieldRef,
  type HistoryResult,
  type NativeEntry,
  type ReadBudget,
  type Scope,
} from "../contracts.js";
import type { PctxConfig } from "../config.js";
import { blocksOf, decodeCursor, encodeCursor, isFieldRef, refForField, utf8Prefix } from "./refs.js";

export const OBSERVATION_ID = /^obs_[a-f0-9]{24}$/;
export const SAFE_SESSION_ID = /^[a-z0-9][a-z0-9._-]*$/iu;
export const REDUCER_RECEIPT_PREFIX = "sol_pi_evidence_receipt_v1";

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export interface ReducerReceipt {
  sourceArtifact: string;
  sourceSha256: string;
}

export interface LoadedArchive {
  text: string;
  hash: string;
  bytes: number;
  blockIndex: number;
}

export function parseObsRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const id = ref.trim();
  return OBSERVATION_ID.test(id) ? id : null;
}

export function parseReducerReceipt(text: string | undefined | null): ReducerReceipt | null {
  if (typeof text !== "string" || !text.includes(REDUCER_RECEIPT_PREFIX)) return null;
  const lines = text.split("\n");
  if (!lines.some((line) => line === REDUCER_RECEIPT_PREFIX)) return null;
  let sourceArtifact: string | null = null;
  let sourceSha256: string | null = null;
  for (const line of lines) {
    if (line.startsWith("source_artifact=")) sourceArtifact = line.slice("source_artifact=".length);
    else if (line.startsWith("source_sha256=")) sourceSha256 = line.slice("source_sha256=".length);
  }
  if (!sourceArtifact || !/^[0-9a-f]{64}$/.test(sourceSha256 ?? "")) return null;
  return { sourceArtifact, sourceSha256: sourceSha256! };
}

export function receiptOf(entry: NativeEntry): ReducerReceipt | null {
  for (const block of blocksOf(entry)) {
    if (block.type === "text" && typeof block.text === "string") {
      const parsed = parseReducerReceipt(block.text);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function nativeTextBlockCount(entry: NativeEntry): number {
  return blocksOf(entry).filter((block) => block.type === "text" && typeof block.text === "string").length;
}

/** FieldRef for the archived original log. Hash comes from the receipt; the file is verified on read. */
export function virtualReducerRef(scope: Scope, entry: NativeEntry, blockIndex: number): FieldRef | null {
  if (!scope.visibleEntryIds.has(entry.id)) return null;
  const receipt = receiptOf(entry);
  if (!receipt) return null;
  if (blockIndex !== nativeTextBlockCount(entry)) return null;
  return {
    v: 6,
    workspaceId: scope.workspaceId,
    sessionId: scope.sessionId,
    entryId: entry.id,
    blockIndex,
    kind: "text",
    sourceHash: receipt.sourceSha256,
  };
}

export function resolveIndexedField(
  scope: Scope,
  entry: NativeEntry,
  blockIndex: number,
  sourceHash: string,
): FieldRef | null {
  const native = refForField(scope, entry, blockIndex);
  if (isFieldRef(native) && native.sourceHash === sourceHash) return native;
  const virtual = virtualReducerRef(scope, entry, blockIndex);
  if (virtual && virtual.sourceHash === sourceHash) return virtual;
  return null;
}

export function observationPaths(sessionDir: string, sessionId: string, obsId: string): {
  objectPath: string;
  ledgerPath: string;
} {
  const root = join(sessionDir, "sol-pi", sessionId, "observation-pack");
  return {
    objectPath: join(root, "objects", `${obsId}.txt`),
    ledgerPath: join(root, "ledger.jsonl"),
  };
}

export function ledgerContentHash(ledgerPath: string, obsId: string): string | null {
  if (!existsSync(ledgerPath)) return null;
  let last: string | null = null;
  const text = readFileSync(ledgerPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { id?: unknown; contentHash?: unknown };
      if (row.id === obsId && typeof row.contentHash === "string" && /^[0-9a-f]{64}$/.test(row.contentHash)) {
        last = row.contentHash;
      }
    } catch {
      /* skip a corrupt ledger line */
    }
  }
  return last;
}

function confinedFile(root: string, candidate: string): string | null {
  if (!candidate.startsWith("/")) return null;
  let rootReal: string;
  let target: string;
  try {
    rootReal = realpathSync(root);
    target = realpathSync(candidate);
  } catch {
    return null;
  }
  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (target !== rootReal && !target.startsWith(prefix)) return null;
  return target;
}

function readRegularUtf8(path: string): { text: string; hash: string; bytes: number } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    const text = readFileSync(fd, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    return { text, hash: sha256Hex(utf8Bytes(text)), bytes };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function loadObservationObject(
  sessionDir: string | null | undefined,
  sessionId: string,
  obsId: string,
): { ok: true; text: string; hash: string; bytes: number } | { ok: false; code: HistoryResult["code"]; diagnostic: string } {
  if (!sessionDir) {
    return { ok: false, code: "source-missing", diagnostic: "requires a persistent Pi session directory" };
  }
  if (!SAFE_SESSION_ID.test(sessionId) || sessionId === "unknown") {
    return { ok: false, code: "denied", diagnostic: "unsafe session id" };
  }
  if (!OBSERVATION_ID.test(obsId)) {
    return { ok: false, code: "denied", diagnostic: "REF_ENTRY" };
  }
  const { objectPath, ledgerPath } = observationPaths(sessionDir, sessionId, obsId);
  const packRoot = join(sessionDir, "sol-pi", sessionId, "observation-pack");
  const confined = confinedFile(packRoot, objectPath);
  if (!confined) return { ok: false, code: "source-missing", diagnostic: "observation object missing" };
  const expected = ledgerContentHash(ledgerPath, obsId);
  if (!expected) return { ok: false, code: "source-missing", diagnostic: "observation ledger hash missing" };
  const loaded = readRegularUtf8(confined);
  if (!loaded) return { ok: false, code: "source-missing", diagnostic: "observation object missing" };
  if (loaded.hash !== expected) return { ok: false, code: "source-changed", diagnostic: "observation hash mismatch" };
  return { ok: true, text: loaded.text, hash: loaded.hash, bytes: loaded.bytes };
}

export function loadReducerArchive(
  sessionDir: string | null | undefined,
  sessionId: string,
  receipt: ReducerReceipt,
  blockIndex: number,
): LoadedArchive | null {
  if (!sessionDir || !SAFE_SESSION_ID.test(sessionId) || sessionId === "unknown") return null;
  const runtimeRoot = join(sessionDir, "sol-pi", sessionId);
  const confined = confinedFile(runtimeRoot, receipt.sourceArtifact);
  if (!confined) return null;
  const loaded = readRegularUtf8(confined);
  if (!loaded || loaded.hash !== receipt.sourceSha256) return null;
  return { text: loaded.text, hash: loaded.hash, bytes: loaded.bytes, blockIndex };
}

export function extraIndexedTexts(
  entry: NativeEntry,
  sessionDir: string | null | undefined,
  sessionId: string,
): LoadedArchive | "pending" | null {
  const receipt = receiptOf(entry);
  if (!receipt) return null;
  if (!sessionDir) return "pending";
  const loaded = loadReducerArchive(sessionDir, sessionId, receipt, nativeTextBlockCount(entry));
  return loaded ?? "pending";
}

function fail(code: HistoryResult["code"], diagnostic: string): HistoryResult {
  return { ok: false, code, cursor: null, nextCursor: null, diagnostic };
}

export function sliceUtf8Page(
  text: string,
  start: number,
  budget: ReadBudget,
  config: PctxConfig,
):
  | { ok: true; page: string; start: number; end: number; total: number }
  | { ok: false; result: HistoryResult } {
  const buf = utf8Bytes(text);
  if (!Number.isInteger(start) || start < 0 || start > buf.length) {
    return { ok: false, result: fail("stale-cursor", "stale-cursor") };
  }
  if (start < buf.length && (buf[start]! & 0xc0) === 0x80) {
    return { ok: false, result: fail("stale-cursor", "stale-cursor") };
  }
  if (start === buf.length) {
    return { ok: true, page: "", start, end: start, total: buf.length };
  }
  const cap = Math.min(budget.maxBytes, config.history.readMaxBytes, buf.length - start);
  let page = utf8Prefix(buf.subarray(start).toString("utf8"), cap);
  while (page && estimateTokens(page) > budget.maxTokens) {
    const bytes = Buffer.byteLength(page, "utf8");
    const over = estimateTokens(page) - budget.maxTokens;
    const nextCap = Math.max(0, bytes - Math.max(1, over * 4));
    page = utf8Prefix(buf.subarray(start).toString("utf8"), nextCap >= bytes ? bytes - 1 : nextCap);
  }
  if (!page) return { ok: false, result: fail("insufficient-context", "INSUFFICIENT_CONTEXT") };
  const end = start + Buffer.byteLength(page, "utf8");
  return { ok: true, page, start, end, total: buf.length };
}

function obsCursorMatches(
  cur: Record<string, unknown>,
  locator: { sessionId: string; obsId: string; sourceHash: string },
): boolean {
  if (cur.kind != null && cur.kind !== "obs-read") return false;
  if (typeof cur.sessionId === "string" && cur.sessionId !== locator.sessionId) return false;
  if (typeof cur.obsId === "string" && cur.obsId !== locator.obsId) return false;
  if (typeof cur.sourceHash === "string" && cur.sourceHash !== locator.sourceHash) return false;
  return true;
}

export function readObservation(input: {
  sessionDir: string | null | undefined;
  sessionId: string;
  obsId: string;
  cursor?: string | null;
  budget: ReadBudget;
  config: PctxConfig;
}): HistoryResult {
  const loaded = loadObservationObject(input.sessionDir, input.sessionId, input.obsId);
  if (!loaded.ok) return fail(loaded.code, loaded.diagnostic);
  let start = 0;
  if (input.cursor) {
    let cur: Record<string, unknown>;
    try {
      cur = decodeCursor(input.cursor);
    } catch {
      return fail("stale-cursor", "stale-cursor");
    }
    if (!obsCursorMatches(cur, { sessionId: input.sessionId, obsId: input.obsId, sourceHash: loaded.hash })) {
      return fail("stale-cursor", "stale-cursor");
    }
    start = Number(cur.byteOffset ?? 0);
  }
  const sliced = sliceUtf8Page(loaded.text, start, input.budget, input.config);
  if (!sliced.ok) return sliced.result;
  const nextOffset = sliced.end < sliced.total ? sliced.end : null;
  const nextCursor =
    nextOffset == null
      ? null
      : encodeCursor({
          v: 6,
          kind: "obs-read",
          sessionId: input.sessionId,
          obsId: input.obsId,
          sourceHash: loaded.hash,
          byteOffset: nextOffset,
        });
  return {
    ok: true,
    code: "ok",
    page: sliced.page,
    cursor: nextCursor,
    nextCursor,
    byteOffset: sliced.start,
    nextByteOffset: nextOffset,
    totalBytes: sliced.total,
    sourceHash: loaded.hash,
    verified: true,
    details: { estimateKind: input.budget.estimateKind, kind: "observation-pack", id: input.obsId },
  };
}
