import {
  ERROR,
  canonicalJson,
  hashCanonical,
  isSha256,
  sha256Hex,
  utf8Bytes,
  utf8Slice,
  type ContentBlock,
  type FieldRef,
  type NativeEntry,
  type RefError,
  type Scope,
  type SourceRef,
} from "../contracts.js";

const PREFIX = "pctx:6:";

export function blocksOf(entry: NativeEntry): ContentBlock[] {
  const content = entry.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

export function textSourceHash(text: string): string {
  return sha256Hex(utf8Bytes(text));
}

export function imageSourceHash(block: { type?: string; mimeType?: string; data?: string }): string {
  return sha256Hex(canonicalJson({ type: block.type ?? "image", mimeType: block.mimeType ?? null, data: block.data ?? null }));
}

export function isFieldRef(value: FieldRef | RefError): value is FieldRef {
  return !("code" in value);
}

export function refForField(scope: Scope, entry: NativeEntry, blockIndex: number): FieldRef | RefError {
  if (!entry?.id) return { code: "REF_ENTRY" };
  if (!scope.visibleEntryIds.has(entry.id)) return { code: "REF_SCOPE" };
  const blocks = blocksOf(entry);
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) {
    return { code: "REF_OUT_OF_RANGE" };
  }
  const block = blocks[blockIndex]!;
  if (block.type === "text" && typeof block.text === "string") {
    return {
      v: 6,
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      entryId: entry.id,
      blockIndex,
      kind: "text",
      sourceHash: textSourceHash(block.text),
    };
  }
  if (block.type === "image") {
    return {
      v: 6,
      workspaceId: scope.workspaceId,
      sessionId: scope.sessionId,
      entryId: entry.id,
      blockIndex,
      kind: "image",
      sourceHash: imageSourceHash(block),
    };
  }
  return { code: "REF_KIND" };
}

export function encodeRef(ref: FieldRef): SourceRef {
  return PREFIX + Buffer.from(JSON.stringify(ref), "utf8").toString("base64url");
}

export function decodeRef(ref: SourceRef): FieldRef | RefError {
  if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return { code: "REF_VERSION" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(ref.slice(PREFIX.length), "base64url").toString("utf8"));
  } catch {
    return { code: "REF_VERSION" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { code: "REF_VERSION" };
  const loc = parsed as Partial<FieldRef>;
  if (loc.v !== 6) return { code: "REF_VERSION" };
  if (!loc.entryId || !loc.workspaceId || !loc.sessionId) return { code: "REF_ENTRY" };
  if (loc.kind !== "text" && loc.kind !== "image") return { code: "REF_KIND" };
  if (typeof loc.blockIndex !== "number" || !Number.isInteger(loc.blockIndex) || loc.blockIndex < 0) {
    return { code: "REF_OUT_OF_RANGE" };
  }
  if (typeof loc.sourceHash !== "string" || !isSha256(loc.sourceHash)) return { code: "REF_KIND" };
  return {
    v: 6,
    workspaceId: loc.workspaceId,
    sessionId: loc.sessionId,
    entryId: loc.entryId,
    blockIndex: loc.blockIndex,
    kind: loc.kind,
    sourceHash: loc.sourceHash,
  };
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

export { ERROR, hashCanonical, utf8Slice, utf8Bytes };
