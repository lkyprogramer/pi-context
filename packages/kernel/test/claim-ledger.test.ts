import { describe, expect, it } from "vitest";
import { ClaimLedger } from "../src/claims/store.js";

function fixtureClaim(partial: { value: string; validFrom: number; systemFrom: number }) {
  return {
    key: "goal/primary",
    claimType: "goal" as const,
    polarity: "is" as const,
    value: partial.value,
    validFrom: partial.validFrom,
    systemFrom: partial.systemFrom,
    supportIds: ["ev_fixture"],
    transformerCeiling: "act" as const,
  };
}

describe("ClaimLedger", () => {
  it("reconstructs what was known separately from when it was valid", async () => {
    const ledger = await ClaimLedger.inMemory();
    await ledger.append(fixtureClaim({ value: "v1", validFrom: 100, systemFrom: 200 }));
    expect((await ledger.asOf({ validAt: 150, systemAt: 250 }))[0]?.value).toBe("v1");
    expect(await ledger.asOf({ validAt: 50, systemAt: 250 })).toEqual([]);
  });

  it("rejects a claim without support", async () => {
    const ledger = await ClaimLedger.inMemory();
    await expect(
      ledger.append({
        key: "decision/x",
        claimType: "decision",
        value: "gone",
        supportIds: [],
        transformerCeiling: "act",
        validFrom: 100,
        systemFrom: 200,
      }),
    ).rejects.toThrow(/PCR_CLAIM_SUPPORT_MISSING/);
    await expect(
      ledger.append({
        key: "decision/x",
        claimType: "decision",
        value: "gone",
        supportIds: ["ev_missing"],
        transformerCeiling: "act",
        validFrom: 100,
        systemFrom: 200,
      }),
    ).rejects.toThrow(/PCR_CLAIM_SUPPORT_MISSING/);
    expect(await ledger.asOf({ validAt: 150, systemAt: 250 })).toEqual([]);
  });

  it("quarantines caller inference instead of writing the current table", async () => {
    const ledger = await ClaimLedger.inMemory();
    const claim = await ledger.append({
      key: "decision/guess",
      claimType: "decision",
      value: "maybe",
      supportIds: [],
      transformerCeiling: "act",
      admissionClass: "inference",
      validFrom: 100,
      systemFrom: 200,
    });
    expect(claim.status).not.toBe("active");
    expect(claim.authority).toBe("propose");
    expect(await ledger.asOf({ validAt: 150, systemAt: 250 })).toEqual([]);
    expect(ledger.quarantined().map((item) => item.claimId)).toEqual([claim.claimId]);
  });

  it("keeps contested versions of the same key", async () => {
    const ledger = await ClaimLedger.inMemory();
    ledger.registerSupport({ evidenceId: "ev_a", authority: "inform" });
    ledger.registerSupport({ evidenceId: "ev_b", authority: "inform" });
    await ledger.append({
      key: "file-state/src",
      claimType: "file-state",
      value: "red",
      supportIds: ["ev_a"],
      transformerCeiling: "act",
      validFrom: 100,
      systemFrom: 200,
    });
    await ledger.append({
      key: "file-state/src",
      claimType: "file-state",
      value: "blue",
      supportIds: ["ev_b"],
      transformerCeiling: "act",
      validFrom: 110,
      systemFrom: 210,
    });
    const visible = await ledger.asOf({ validAt: 150, systemAt: 250 });
    expect(visible.map((item) => item.value).sort()).toEqual(["blue", "red"]);
    expect(new Set(visible.map((item) => item.status))).toEqual(new Set(["active"]));
  });

  it("does not revive a retracted claim from as-of without policy", async () => {
    const ledger = await ClaimLedger.inMemory();
    const claim = await ledger.append(fixtureClaim({ value: "v1", validFrom: 100, systemFrom: 200 }));
    await ledger.retract(claim.claimId, 240);
    expect(await ledger.asOf({ validAt: 150, systemAt: 250 })).toEqual([]);
    expect((await ledger.asOf({ validAt: 150, systemAt: 230 }))[0]?.value).toBe("v1");
    const historical = await ledger.asOf({ validAt: 150, systemAt: 250, policy: "include-retracted" });
    expect(historical).toHaveLength(1);
    expect(historical[0]?.status).toBe("retracted");
  });

  it.each([
    [{ validAt: 100, systemAt: 200 }, "v1"],
    [{ validAt: 99, systemAt: 200 }, undefined],
    [{ validAt: 100, systemAt: 199 }, undefined],
  ])("as-of %j reconstructs %s", async (query, expected) => {
    const ledger = await ClaimLedger.inMemory();
    await ledger.append(fixtureClaim({ value: "v1", validFrom: 100, systemFrom: 200 }));
    expect((await ledger.asOf(query))[0]?.value).toBe(expected);
  });

  it("binds authority to the min of support and transformer ceiling", async () => {
    const ledger = await ClaimLedger.inMemory();
    ledger.registerSupport({ evidenceId: "ev_inform", authority: "inform" });
    const claim = await ledger.append({
      key: "outcome/deploy",
      claimType: "outcome",
      value: "shipped",
      supportIds: ["ev_inform"],
      transformerCeiling: "act",
      validFrom: 1,
      systemFrom: 1,
    });
    expect(claim.authority).toBe("inform");
  });
});
