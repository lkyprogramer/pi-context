import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETRIEVAL_BUDGETS,
  boundDirectoryPointers,
  boundRecallPage,
  estimateTextTokens,
  retrievalPageTokenEstimate,
  sliceUtf8Page,
} from "../../src/index.js";

describe("bounded retrieval", () => {
  it("deduplicates directory pointers and observes both page ceilings", () => {
    const directory = boundDirectoryPointers([
      { ref: "src/api.ts", kind: "file" },
      { ref: "src/api.ts", kind: "file" },
      { ref: "src/runtime.ts", kind: "file" },
    ], DEFAULT_RETRIEVAL_BUDGETS.directoryTokens, 1);

    expect(directory.items).toEqual([{ ref: "src/api.ts", kind: "file" }]);
    expect(directory.omitted).toEqual([
      { ref: "src/api.ts", reason: "duplicate" },
      { ref: "src/runtime.ts", reason: "budget" },
    ]);
    expect(retrievalPageTokenEstimate({
      directoryTokens: DEFAULT_RETRIEVAL_BUDGETS.directoryTokens,
      recallTokens: DEFAULT_RETRIEVAL_BUDGETS.recallTokens,
    })).toBe(DEFAULT_RETRIEVAL_BUDGETS.pageTokens);
  });

  it("never trusts an underestimated recall item", () => {
    const quote = "a recall item whose text cost exceeds the stated token count";
    const page = boundRecallPage([
      { evidenceId: "ev_first", quote, tokens: 1 },
      { evidenceId: "ev_duplicate", quote, tokens: 1 },
    ], estimateTextTokens(quote));

    expect(page.items).toHaveLength(1);
    expect(page.tokenEstimate).toBe(estimateTextTokens(quote));
    expect(page.omitted).toEqual([{ evidenceId: "ev_duplicate", reason: "duplicate" }]);
  });

  it("rejects mid-codepoint offsets and preserves complete UTF8 pages", () => {
    const bytes = Buffer.from("A中🙂Z", "utf8");
    expect(() => sliceUtf8Page({ bytes, byteOffset: 2, maxBytes: 8 })).toThrow("INVALID_BYTE_OFFSET");
    const page = sliceUtf8Page({ bytes, byteOffset: 1, maxBytes: 7 });
    expect(Buffer.from(page.bytes).toString("utf8")).toBe("中🙂");
    expect(page.nextByteOffset).toBe(8);
  });
});
