import { describe, expect, it } from "vitest";

import { createCheckpointRenderer, createCheckpointVerifier, createRuntimeCursor, emptyContinuityRevision, retainedTailIds, toolPairsValid, twoRunHash, verifyHardGates } from "@pcr/core";
import { createCompactionService, createCompactionSnapshotAssembler } from "@pcr/runtime";

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

  it("hard-stops prepareCompaction when messagesToSummarize has an unpaired tool result", async () => {
    const cursor = createRuntimeCursor({
      workspacePath: "/tmp/pcr-hard-gate-orphan",
      sessionId: "session-orphan",
      leafId: "leaf-orphan",
      lineageEntryIds: ["root", "leaf-orphan"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const service = createCompactionService({
      cursor,
      assembler: createCompactionSnapshotAssembler({
        cursor,
        transaction: { async run(work) { return work(); } },
        directives: { async active() { return []; } },
        continuity: { async current() { return emptyContinuityRevision(cursor); } },
        claims: { async list() { return []; } },
        evidence: { async pointers() { return []; } },
      }),
      renderer: createCheckpointRenderer({ cursor }),
      verifier: createCheckpointVerifier({
        cursor,
        pointers: { async verify() {} },
      }),
    });
    await expect(service.prepareCompaction({
      operationId: "op-orphan",
      cursor,
      reason: "threshold",
      now: 1,
      tokensBefore: 8000,
      firstKeptEntryId: "entry-keep",
      messagesToSummarize: [{ role: "toolResult", toolCallId: "orphan-call", id: "r-orphan" }],
    })).resolves.toEqual({ kind: "hard-stop", code: "PCR_HARD_GATE_TOOL_PAIR" });
  });

  it("hard-stops prepareCompaction when firstKept splits a tool pair tail", async () => {
    const cursor = createRuntimeCursor({
      workspacePath: "/tmp/pcr-hard-gate-tail",
      sessionId: "session-tail",
      leafId: "leaf-tail",
      lineageEntryIds: ["root", "leaf-tail"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const service = createCompactionService({
      cursor,
      assembler: createCompactionSnapshotAssembler({
        cursor,
        transaction: { async run(work) { return work(); } },
        directives: { async active() { return []; } },
        continuity: { async current() { return emptyContinuityRevision(cursor); } },
        claims: { async list() { return []; } },
        evidence: { async pointers() { return []; } },
      }),
      renderer: createCheckpointRenderer({ cursor }),
      verifier: createCheckpointVerifier({
        cursor,
        pointers: { async verify() {} },
      }),
    });
    await expect(service.prepareCompaction({
      operationId: "op-tail",
      cursor,
      reason: "threshold",
      now: 1,
      tokensBefore: 8000,
      firstKeptEntryId: "r1",
      messagesToSummarize: [
        { role: "assistant", toolCallId: "c1", id: "a1", hostMessageId: "a1" },
        { role: "toolResult", toolCallId: "c1", id: "r1", hostMessageId: "r1" },
      ],
    })).resolves.toEqual({ kind: "hard-stop", code: "PCR_HARD_GATE_BROKEN_TAIL" });
  });
});
