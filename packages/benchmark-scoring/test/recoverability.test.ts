import { describe, expect, it } from "vitest";
import { inMemoryEncryptedStore, scoreRecoverability, sha256Bytes, type RecoverabilityInput } from "../src/recoverability.js";

function recoveryFixture(): RecoverabilityInput {
  const bytes = new TextEncoder().encode("full build output\nERROR 42\n");
  return {
    scope: { workspaceId: "w1", sessionId: "s1", branchId: "b1" },
    requests: [{ handle: "blob-1", expectedSha256: sha256Bytes(bytes), expectedLength: bytes.length }],
    store: inMemoryEncryptedStore([{ handle: "blob-1", scope: "w1/s1/b1", bytes }]),
  };
}

function crossScopeFixture(): RecoverabilityInput {
  return { ...recoveryFixture(), scope: { workspaceId: "w2", sessionId: "s1", branchId: "b1" } };
}

describe("recoverability", () => {
  it("recovers exact bytes and verifies sha256", async () => {
    const report = await scoreRecoverability(recoveryFixture());
    expect(report.exactRecoveryRate).toBe(1);
    expect(report.records[0]?.observedSha256).toBe(report.records[0]?.expectedSha256);
  });

  it("rejects the same handle from another workspace", async () => {
    const report = await scoreRecoverability(crossScopeFixture());
    expect(report.crossScopeLeaks).toBe(0);
    expect(report.records[0]?.failureCode).toBe("SCOPE_DENIED");
  });
});
