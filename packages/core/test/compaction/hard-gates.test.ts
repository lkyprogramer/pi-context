import { describe, expect, it } from "vitest";

import {
  retainedTailIds,
  toolPairsValid,
  twoRunHash,
  verifyHardGates,
} from "../../src/compaction/hard-gates.js";

describe("tool-pair / retained-tail / two-run hash verifier", () => {
  it("rejects orphan results and unpaired calls", () => {
    expect(toolPairsValid([
      { role: "tool-result", toolCallId: "c1", id: "r1" },
    ])).toBe(false);
    expect(toolPairsValid([
      { role: "assistant", toolCallId: "c1", id: "a1" },
    ])).toBe(false);
    expect(toolPairsValid([
      { role: "assistant", toolCallId: "c1", id: "a1" },
      { role: "tool-result", toolCallId: "c1", id: "r1" },
    ])).toBe(true);
  });

  it("does not split a tool pair when cutting the retained tail", () => {
    const messages = [
      { role: "user", id: "u0" },
      { role: "assistant", toolCallId: "c1", id: "a1" },
      { role: "tool-result", toolCallId: "c1", id: "r1" },
      { role: "user", id: "u1" },
    ];
    expect(retainedTailIds(messages, "r1")).toEqual(["a1", "r1", "u1"]);
  });

  it("hashes two renders of reordered keys to the same receipt", () => {
    const receipt = verifyHardGates({
      messages: [
        { role: "assistant", toolCallId: "c1", id: "a1" },
        { role: "tool-result", toolCallId: "c1", id: "r1" },
      ],
      firstKeptId: "a1",
      payload: { b: 1, a: 2 },
      render: () => ({ a: 2, b: 1 }),
    });
    expect(receipt.toolPairOk).toBe(true);
    expect(receipt.outputHash).toBe(receipt.secondRunHash);
    expect(receipt.outputHash).toBe(twoRunHash({ a: 2, b: 1 }));
    expect(receipt.outputHash).not.toBe("0");
    expect(receipt.outputHash).not.toBe("1");
  });
});
