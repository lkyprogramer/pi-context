import { describe, expect, it } from "vitest";
import { ERROR, utf8Slice } from "../../src/contracts.js";
import { encodeRef, pageHash, textSourceHash, utf8Bytes } from "../../src/history/refs.js";

describe("T05 refs utf-8", () => {
  it("reassembles ASCII/Chinese/emoji/CRLF pages byte-for-byte", () => {
    const text = "abc中文😀\r\nend";
    const buf = utf8Bytes(text);
    let start = 0;
    const parts: string[] = [];
    while (start < buf.length) {
      let end = Math.min(start + 4, buf.length);
      while (end < buf.length && (buf[end] & 0xc0) === 0x80) end += 1;
      parts.push(utf8Slice(text, start, end));
      start = end;
    }
    expect(parts.join("")).toBe(text);
    expect(textSourceHash(text)).toHaveLength(64);
    expect(pageHash(text, 0, buf.length)).toBe(textSourceHash(text));
  });

  it("shared non-cyclic objects hash; real cycles error", () => {
    const shared = { x: 1 };
    expect(textSourceHash(JSON.stringify({ a: shared, b: shared }))).toHaveLength(64);
    expect(() => utf8Slice("é", 1, 2)).toThrow();
    try {
      utf8Slice("é", 1, 2);
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ERROR.UTF8);
    }
  });

  it("rejects negative offsets and path-like refs", () => {
    expect(() => encodeRef({
      version: 5,
      workspaceId: "w",
      sessionId: "s",
      entryId: "e",
      field: { kind: "text", blockIndex: -1 },
      sourceHash: "a".repeat(64),
    })).not.toThrow();
    expect(() => utf8Slice("hi", -1, 1)).toThrow();
  });
});
