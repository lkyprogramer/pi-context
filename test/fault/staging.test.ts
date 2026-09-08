import { describe, expect, it } from "vitest";
import {
  ack,
  bumpFence,
  commitNative,
  onCompactFailed,
  propose,
  restoreFromNative,
} from "../../src/checkpoint/staging.js";

const H = "a".repeat(64);
const H2 = "b".repeat(64);

describe("T17 staging ACK", () => {
  it("F07 wrong hash does not commit; duplicate ACK does not double-count", () => {
    const p = propose({ generation: 1, hash: H });
    expect(p.status).toBe("proposed");
    const wrong = ack(p, { hash: H2, generation: 1 });
    expect(wrong.status).toBe("proposed");
    const empty = ack(p, { hash: "", generation: 1 });
    expect(empty.status).toBe("proposed");
    const once = ack(p, { hash: H, generation: 1 });
    expect(once.status).toBe("acked");
    expect(once.ackCount).toBe(1);
    const dup = ack(once, { hash: H, generation: 1 });
    expect(dup.status).toBe("acked");
    expect(dup.ackCount).toBe(1);
    const committed = commitNative(once, { generation: 1, nativeEntryId: "c1", nativeHash: H });
    expect(committed.status).toBe("committed");
    expect(committed.nativeEntryId).toBe("c1");
    const mismatch = commitNative(once, { generation: 1, nativeEntryId: "c1", nativeHash: H2 });
    expect(mismatch.status).toBe("acked");
  });

  it("native already written restores without a new proposal", () => {
    const p = propose({ generation: 2, hash: H, nativeAlreadyWritten: true });
    expect(p.status).toBe("idle");
    const restored = restoreFromNative({ generation: 2, nativeEntryId: "native", nativeHash: H });
    expect(restored.status).toBe("committed");
    expect(restored.nativeEntryId).toBe("native");
    const again = propose({ generation: 2, hash: H2 });
    expect(again.status).toBe("proposed");
  });

  it("failed compact drops same-generation ACK; fence drops late ACK", () => {
    const p = propose({ generation: 3, hash: H });
    const acked = ack(p, { hash: H, generation: 3 });
    expect(acked.status).toBe("acked");
    const failed = onCompactFailed(acked);
    expect(failed.status).toBe("idle");
    const late = ack(failed, { hash: H, generation: 3 });
    expect(late.status).toBe("idle");
    const fenced = bumpFence(acked);
    expect(ack(fenced, { hash: H, generation: 3 }).status).toBe("idle");
  });
});
