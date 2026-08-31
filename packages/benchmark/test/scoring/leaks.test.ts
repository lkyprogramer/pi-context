import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createIntegrityScorer, scoreLeakSurfaces } from "@pcr/benchmark";

const HASH = "a".repeat(64);

function scorer() {
  return createIntegrityScorer({
    blobs: {
      async read() { return Buffer.from("ok"); },
    },
  });
}

const base = {
  workspaceId: "ws-a",
  sessionId: "s1",
  directives: { expected: ["keep"], observed: ["keep"] },
  pairs: { calls: [], results: [] },
  recoveries: [] as const,
  hashes: { first: HASH, second: HASH },
};

describe("integrity leak surfaces", () => {
  it("counts an encoded secret and a split secret across surfaces", async () => {
    const secret = "hunter2-token";
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    expect(scoreLeakSurfaces([secret], [`payload:${encoded}`]).leakCount).toBe(1);
    expect(scoreLeakSurfaces([secret], ["hunter2-", "token in fts snippet"]).leakCount).toBe(1);
    const baseline = await scorer().score(base);
    expect(baseline.recoveryRate).toBe(1);
  });

  it("counts a late response leak", async () => {
    expect(scoreLeakSurfaces(["sk-live-secret"], ["assistant final: do not show sk-live-secret ever"]).leakCount).toBe(1);
    expect(scoreLeakSurfaces(["sk-live-secret"], ["ok"]).leakCount).toBe(0);
  });
});

void createHash;
