import { describe, expect, it } from "vitest";

import { domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { candidateKeyHash, createCandidateKey } from "../../src/background/candidates.js";

describe("candidate key", () => {
  it("hashes cursor, source head and config fingerprint", () => {
    const cursor = createRuntimeCursor({
      workspacePath: "/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-14eb40de3fb3/implementer/t37-key",
      sessionId: "session-key",
      leafId: "leaf-key",
      lineageEntryIds: ["root", "leaf-key"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = createCandidateKey({
      cursor,
      sourceHead: domainHash("t37-head", "h1"),
      configFingerprint: domainHash("t37-config", "v1"),
    });
    expect(candidateKeyHash(key)).toMatch(/^[a-f0-9]{64}$/u);
    expect(candidateKeyHash(key)).toBe(candidateKeyHash({ ...key }));
  });
});
