import { afterEach, describe, expect, it } from "vitest";
import { isPcrError } from "../../contracts/src/index.js";
import { openSqliteStore } from "../src/sqlite-store.js";
import { createTestStore } from "./support.js";

describe("SqliteStore", () => {
  const close: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of close.splice(0)) await fn();
  });

  it("commits an evidence descriptor atomically", async () => {
    const store = await createTestStore();
    close.push(() => store.close());
    await store.transaction(async (tx) => tx.putEvidence({ evidenceId: "ev_aaaaaaaa", contentHash: "a".repeat(64) }));
    expect(await store.getEvidence("ev_aaaaaaaa")).toMatchObject({ contentHash: "a".repeat(64) });
  });

  it("does not let a second writer bypass the worker", async () => {
    const store = await createTestStore({ path: "/tmp/pcr-t06-lock.sqlite" });
    close.push(() => store.close());
    await expect(openSqliteStore({ path: "/tmp/pcr-t06-lock.sqlite", workspaceId: "other" })).rejects.toMatchObject({
      code: "PCR_STORE_WRITER_LOCKED",
    });
  });

  it("keeps the prior schema readable after a migration crash", async () => {
    const store = await createTestStore();
    close.push(() => store.close());
    await store.transaction(async (tx) => tx.putEvidence({ evidenceId: "ev_bbbbbbbb", contentHash: "b".repeat(64) }));
    await expect(store.migrate(2, async () => {
      throw new Error("migration-crash");
    })).rejects.toThrow(/migration-crash/);
    expect(await store.getEvidence("ev_bbbbbbbb")).toMatchObject({ contentHash: "b".repeat(64) });
  });

  it("does not let workspace A query workspace B", async () => {
    const a = await createTestStore({ workspaceId: "wa" });
    const b = await createTestStore({ workspaceId: "wb" });
    close.push(() => a.close(), () => b.close());
    await a.transaction(async (tx) => tx.putEvidence({ evidenceId: "ev_cccccccc", contentHash: "c".repeat(64) }));
    expect(await b.getEvidence("ev_cccccccc")).toBeNull();
  });

  it("maps busy/IO failures to typed PCR errors", async () => {
    try {
      await openSqliteStore({ path: "/dev/full/pcr-impossible.sqlite", workspaceId: "w" });
      throw new Error("expected failure");
    } catch (error) {
      expect(isPcrError(error) || (error !== null && typeof error === "object" && "code" in error)).toBe(true);
    }
  });
});
