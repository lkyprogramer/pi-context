import { describe, expect, it } from "vitest";

import { renderModelCheckpointView, uniqueShortRefs } from "../src/compaction-service.js";

describe("checkpoint metadata ablation", () => {
  it("lengthens short refs until pointer prefixes no longer collide", () => {
    const left = `abcdef012345${"0".repeat(52)}`;
    const right = `abcdef012345${"1".repeat(52)}`;
    const refs = uniqueShortRefs([left, right], 12);
    expect(refs.get(left)).not.toBe(refs.get(right));
    expect(refs.get(left)?.length ?? 0).toBeGreaterThan(12);
  });

  it("keeps full hashes out of the model view while debug export retains them", () => {
    const snapshotHash = "a".repeat(64);
    const pointerRef = "b".repeat(64);
    const checkpoint = {
      snapshotHash,
      directives: [{
        directiveId: "d".repeat(64),
        exactQuote: "do not deploy",
        kind: "prohibition",
        polarity: "must-not",
        status: "active",
      }],
      claims: [{ claimId: "c1", key: "env", polarity: "is", status: "active", value: "staging" }],
      pointers: [{ ref: pointerRef, kind: "evidence" }],
      heads: { contextHead: "1".repeat(64), directiveHead: "2".repeat(64) },
      continuity: { revisionId: "cr_".padEnd(64, "e") },
    };
    const ablated = renderModelCheckpointView(checkpoint);
    const debug = renderModelCheckpointView(checkpoint, { includeMetadata: true });
    expect(ablated.summary.includes(snapshotHash)).toBe(false);
    expect(ablated.summary.includes(pointerRef)).toBe(false);
    expect(ablated.summary).toContain("do not deploy");
    expect(debug.summary).toContain(snapshotHash);
    expect(debug.summary.length).toBeGreaterThan(ablated.summary.length);
  });
});
