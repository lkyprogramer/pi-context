import { describe, expect, it } from "vitest";

import { retainedTailIds, toolPairsValid, twoRunHash, verifyHardGates } from "@pcr/core";

describe("checkpoint hard gates from real message shapes", () => {
  it("computes tool-pair, retained-tail, and two-run hash from messages rather than runner constants", () => {
    const messages = [
      { role: "user", id: "u0", hostMessageId: "u0" },
      {
        role: "assistant",
        id: "a1",
        hostMessageId: "a1",
        toolCallId: "call_9",
        content: [{ type: "toolCall", id: "call_9", name: "bash", arguments: { cmd: "pwd" } }],
      },
      { role: "toolResult", id: "r1", hostMessageId: "r1", toolCallId: "call_9" },
      { role: "user", id: "u1", hostMessageId: "u1" },
    ];
    const receipt = verifyHardGates({
      messages,
      firstKeptId: "r1",
      payload: messages,
      render: () => messages.map((item) => ({ id: item.id, role: item.role, toolCallId: item.toolCallId })),
    });
    expect(receipt.toolPairOk).toBe(true);
    expect(receipt.retainedTailIds).toEqual(["a1", "r1", "u1"]);
    expect(receipt.outputHash).toBe(receipt.secondRunHash);
    expect(receipt.outputHash).toBe(twoRunHash(messages.map((item) => ({
      id: item.id,
      role: item.role,
      toolCallId: item.toolCallId,
    }))));
    expect(toolPairsValid([{ role: "toolResult", toolCallId: "missing" }])).toBe(false);
    expect(retainedTailIds(messages, "u1")).toEqual(["u1"]);
  });

  it("rejects a split tool pair and keeps two-run hashes independent of object key order", () => {
    const split = [
      { role: "assistant", toolCallId: "c1", id: "a1" },
      { role: "user", id: "u-mid" },
      { role: "tool-result", toolCallId: "c1", id: "r1" },
    ];
    expect(toolPairsValid(split)).toBe(false);
    expect(twoRunHash({ z: 1, a: 2 })).toBe(twoRunHash({ a: 2, z: 1 }));
  });
});
