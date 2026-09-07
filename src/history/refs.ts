import {
  ERROR,
  hashCanonical,
  isSha256,
  sha256Hex,
  utf8Bytes,
  utf8Slice,
  type SourceLocator,
  type SourceRef,
} from "../contracts.js";

const PREFIX = "pctx:v5:";

export function encodeRef(locator: SourceLocator): SourceRef {
  return PREFIX + Buffer.from(JSON.stringify(locator), "utf8").toString("base64url");
}

export function decodeRef(ref: SourceRef): SourceLocator {
  if (!ref.startsWith(PREFIX)) {
    const err = new Error("invalid source ref");
    (err as { code?: string }).code = ERROR.REF;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(ref.slice(PREFIX.length), "base64url").toString("utf8"));
  } catch {
    const err = new Error("invalid source ref encoding");
    (err as { code?: string }).code = ERROR.REF;
    throw err;
  }
  const loc = parsed as SourceLocator;
  if (loc.version !== 5 || !loc.entryId || !isSha256(loc.sourceHash) || !loc.field) {
    const err = new Error("invalid source locator");
    (err as { code?: string }).code = ERROR.REF;
    throw err;
  }
  if (typeof loc.field.blockIndex !== "number" || loc.field.blockIndex < 0 || !Number.isInteger(loc.field.blockIndex)) {
    const err = new Error("invalid block index");
    (err as { code?: string }).code = ERROR.REF;
    throw err;
  }
  return loc;
}

export function textSourceHash(text: string): string {
  return sha256Hex(utf8Bytes(text));
}

export function pageHash(text: string, startByte: number, endByteExclusive: number): string {
  const slice = utf8Slice(text, startByte, endByteExclusive);
  return sha256Hex(utf8Bytes(slice));
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
}

export { hashCanonical, utf8Slice, utf8Bytes };
