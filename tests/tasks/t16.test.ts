import { describe, expect, it } from "vitest";

import { createRuntimeCursor, createClauseSegmenter } from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t16",
    sessionId: "session-t16",
    leafId: "leaf-t16",
    lineageEntryIds: ["root", "leaf-t16"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function reconstruct(text: string, spans: Array<{
  text: string;
  utf8ByteRange: { start: number; end: number };
  utf16Range: { start: number; end: number };
  codePointRange: { start: number; end: number };
}>) {
  const utf8 = Buffer.from(text, "utf8");
  const codePoints = [...text];
  return spans.map((span) => ({
    text: span.text,
    fromUtf16: text.slice(span.utf16Range.start, span.utf16Range.end),
    fromUtf8: utf8.subarray(span.utf8ByteRange.start, span.utf8ByteRange.end).toString("utf8"),
    fromCodePoints: codePoints.slice(span.codePointRange.start, span.codePointRange.end).join(""),
  }));
}

async function runT16Fixture(): Promise<{ ok: true; task: "T16" }> {
  const bound = cursor();
  const segmenter = createClauseSegmenter({ cursor: bound });
  const text = "改为使用 SHA-256。Do not leak 密钥👍. Keep tests.";
  const first = segmenter.segment({ text, cursor: bound });
  const second = segmenter.segment({ text, cursor: bound });
  expect(second).toEqual(first);
  expect(first.length).toBeGreaterThan(1);
  expect(first.some((span) => span.text.includes("改为使用 SHA-256"))).toBe(true);
  expect(first.some((span) => span.text.includes("Do not leak 密钥👍"))).toBe(true);
  const views = reconstruct(text, first);
  for (const view of views) {
    expect(view.fromUtf16).toBe(view.text);
    expect(view.fromUtf8).toBe(view.text);
    expect(view.fromCodePoints).toBe(view.text);
  }
  const thumbs = first.find((span) => span.text.includes("👍"));
  expect(thumbs).toBeDefined();
  expect(thumbs!.utf8ByteRange.end - thumbs!.utf8ByteRange.start).toBeGreaterThan(
    thumbs!.utf16Range.end - thumbs!.utf16Range.start,
  );
  expect(thumbs!.utf16Range.end - thumbs!.utf16Range.start).toBeGreaterThan(
    thumbs!.codePointRange.end - thumbs!.codePointRange.start,
  );
  return { ok: true, task: "T16" };
}

describe("T16 Unicode clause segmentation with real offsets", () => {
  it("unicode_clause_segmentation_with_real_offsets", async () => {
    await expect(runT16Fixture()).resolves.toEqual({ ok: true, task: "T16" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createClauseSegmenter({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CLAUSE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed text before emitting spans", () => {
    const bound = cursor();
    const segmenter = createClauseSegmenter({ cursor: bound });
    expect(() => segmenter.segment({} as never)).toThrowError(/PCR_CLAUSE_INPUT_INVALID/);
    expect(() => segmenter.segment({ text: "ok\uD800", cursor: bound })).toThrowError(/PCR_CLAUSE_INPUT_INVALID/);
  });

  it("replays the same spans for the same text", () => {
    const bound = cursor();
    const segmenter = createClauseSegmenter({ cursor: bound });
    const text = "First clause. Second clause.";
    expect(segmenter.segment({ text, cursor: bound })).toEqual(segmenter.segment({ text, cursor: bound }));
  });

  it("rejects a turn from the wrong workspace/session/branch", () => {
    const bound = cursor();
    const segmenter = createClauseSegmenter({ cursor: bound });
    expect(() => segmenter.segment({
      text: "Keep this.",
      cursor: { ...bound, sessionId: "other-session" },
    })).toThrowError(/PCR_CLAUSE_SCOPE_MISMATCH/);
  });

  it("stops at the abort boundary before scanning text", () => {
    const bound = cursor();
    const segmenter = createClauseSegmenter({ cursor: bound });
    const controller = new AbortController();
    controller.abort();
    expect(() => segmenter.segment({
      text: "Keep this.",
      cursor: bound,
      signal: controller.signal,
    })).toThrow();
  });
});
