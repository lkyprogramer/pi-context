import { describe, expect, it } from "vitest";
import { ack, bumpFence, onCompactFailed, propose } from "../../src/checkpoint/staging.js";

describe("T17 staging", () => {
  it("F07 wrong hash does not commit; duplicate ACK does not double-count", () => {
    const p = propose({ generation: 1, hash: "a".repeat(64) });
    expect(p.status).toBe("proposed");
    const wrong = ack(p, { hash: "b".repeat(64), generation: 1, nativeEntryId: "c1" });
    expect(wrong.status).not.toBe("committed");
    const once = ack(p, { hash: "a".repeat(64), generation: 1, nativeEntryId: "c1" });
    expect(once.status).toBe("committed");
    expect(once.ackCount).toBe(1);
    const dup = ack(once, { hash: "a".repeat(64), generation: 1, nativeEntryId: "c1" });
    expect(dup.ackCount).toBe(1);
    expect(dup.status).toBe("committed");
  });

  it("native already written restores without a new proposal", () => {
    const p = propose({ generation: 2, hash: "a".repeat(64), nativeAlreadyWritten: true });
    expect(p.status).toBe("idle");
    const restored = ack(p, { hash: "a".repeat(64), generation: 2, nativeEntryId: "native", nativeAlreadyWritten: true });
    expect(restored.status).toBe("committed");
    expect(restored.nativeEntryId).toBe("native");
  });

  it("failed compact, branch, or model change invalidates a late ACK", () => {
    const p = propose({ generation: 3, hash: "a".repeat(64) });
    expect(onCompactFailed(p).status).toBe("idle");
    const fenced = bumpFence(p);
    const late = ack(fenced, { hash: "a".repeat(64), generation: 3, nativeEntryId: "c1" });
    expect(late.status).toBe("idle");
  });
});
