import { describe, expect, it } from "vitest";
import { recoveryFixture } from "./support.js";

describe("Saga recovery", () => {
  it("recovers a host-visible operation whose runtime acknowledgment was lost", async () => {
    const fx = await recoveryFixture({ crashAfter: "host-visible" });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("committed");
    expect(await fx.countCommittedReceipts()).toBe(1);
  });

  it("retries when the crash happens before blob publish", async () => {
    const fx = await recoveryFixture({ crashAfter: "before-blob" });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("prepared");
    expect(await fx.countCommittedReceipts()).toBe(0);
  });

  it("keeps an orphan prepared operation after blob publish but before descriptor", async () => {
    const fx = await recoveryFixture({ crashAfter: "after-blob" });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("prepared");
    expect(await fx.countCommittedReceipts()).toBe(0);
  });

  it("does not commit when the crash is after blob and before host descriptor", async () => {
    const fx = await recoveryFixture({ crashAfter: "before-descriptor" });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("prepared");
    expect(await fx.countCommittedReceipts()).toBe(0);
  });

  it("does not invent a receipt for a host message without one", async () => {
    const fx = await recoveryFixture({ hostOnly: true });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("absent");
    expect(await fx.countCommittedReceipts()).toBe(0);
  });

  it("marks a receipt stale when branch ancestry does not match", async () => {
    const fx = await recoveryFixture({ crashAfter: "after-blob", seedHost: { branchScope: "fork" } });
    await fx.reopenAndRecover();
    expect(await fx.operationState()).toBe("stale");
    expect(await fx.countCommittedReceipts()).toBe(0);
  });

  it("is idempotent when recovery runs twice", async () => {
    const fx = await recoveryFixture({ crashAfter: "host-visible" });
    await fx.reopenAndRecover();
    await fx.recoverAgain();
    expect(await fx.operationState()).toBe("committed");
    expect(await fx.countCommittedReceipts()).toBe(1);
  });
});
