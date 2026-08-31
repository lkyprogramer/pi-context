import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createIntegrityScorer } from "@pcr/benchmark";

describe("integrity scorer", () => {
  it("does not treat mustOmitLeak as recovery", async () => {
    const raw = Buffer.from("secret-bytes");
    const scorer = createIntegrityScorer({
      blobs: {
        async read() { return raw; },
      },
    });
    const score = await scorer.score({
      workspaceId: "ws-a",
      sessionId: "s1",
      directives: { expected: ["keep"], observed: ["keep"] },
      pairs: { calls: [], results: [] },
      recoveries: [{
        blobId: "blob_x",
        expectedSha256: createHash("sha256").update("other").digest("hex"),
        expectedBytes: raw.byteLength,
        mustOmitLeak: true,
      }],
      hashes: { first: "a".repeat(64), second: "a".repeat(64) },
    });
    expect(score.recoveryRate).toBe(0);
  });
});
