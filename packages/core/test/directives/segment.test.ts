import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import { createClauseSegmenter, segmentClauses } from "../../src/directives/segment.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-core-segment",
    sessionId: "session-segment",
    leafId: "leaf-segment",
    lineageEntryIds: ["root", "leaf-segment"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("clause segmentation encodings", () => {
  it("keeps utf8/utf16/codepoint ranges aligned with the original string", () => {
    const text = "不要泄露密钥。Keep 👍 tests.";
    const spans = segmentClauses({ text });
    expect(spans.map((span) => span.text).join("")).toBe(text);
    const utf8 = Buffer.from(text, "utf8");
    const codePoints = [...text];
    for (const span of spans) {
      expect(text.slice(span.utf16Range.start, span.utf16Range.end)).toBe(span.text);
      expect(utf8.subarray(span.utf8ByteRange.start, span.utf8ByteRange.end).toString("utf8")).toBe(span.text);
      expect(codePoints.slice(span.codePointRange.start, span.codePointRange.end).join("")).toBe(span.text);
    }
  });

  it("binds a cursor and refuses a different session", () => {
    const bound = cursor();
    const segmenter = createClauseSegmenter({ cursor: bound });
    expect(segmenter.segment({ text: "Keep this.", cursor: bound }).length).toBeGreaterThan(0);
    expect(() => segmenter.segment({
      text: "Keep this.",
      cursor: { ...bound, sessionId: "other" },
    })).toThrowError(/PCR_CLAUSE_SCOPE_MISMATCH/);
  });
});
