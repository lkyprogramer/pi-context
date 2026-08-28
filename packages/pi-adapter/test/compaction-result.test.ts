import { describe, expect, it } from "vitest";
import { emptyPiCompactionUsage } from "../src/compaction-ack.js";
import { toPiCompactionResult } from "../src/compaction-hook.js";

describe("hook compaction result", () => {
  it("always includes a zero usage object so Pi can read totalTokens", () => {
    const result = toPiCompactionResult({
      firstKeptEntryId: "entry_tail",
      summary: "do not deploy prod",
      tokensBefore: 6000,
      estimatedTokensAfter: 1200,
      details: {
        schemaVersion: 1,
        directiveHead: "dh",
        claimHead: "ch",
        continuityHead: "cth",
        catalogHead: "cah",
        outputHash: "a".repeat(64),
        reducerRevisions: [],
      },
    });
    expect(result.usage).toEqual(emptyPiCompactionUsage());
    expect(result.usage.totalTokens).toBe(0);
  });
});
