import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeCursor } from "@pcr/core";
import { openWorkspaceRecallLeaseStore, openWorkspaceSqliteStore } from "@pcr/storage-node";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pcr-recall-lease-")); roots.push(root);
  const cursor = createRuntimeCursor({ workspacePath: root, sessionId: "session", leafId: "leaf", lineageEntryIds: ["root", "leaf"], modelKey: "provider/model" });
  const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId: cursor.workspaceId, busyTimeoutMs: 1000 });
  return { root, cursor, database, store: openWorkspaceRecallLeaseStore({ database }) };
}
const lease = (cursor: ReturnType<typeof createRuntimeCursor>, expiresAt = 1000, remainingUses = 2, leaseId = "ls_test") => ({ leaseId, pageId: "page", purpose: "test", authority: "inform" as const, turns: 0, tokenTurns: 0, issuedAt: 0, expiresAt, remainingUses, status: "active" as const, cursor });

describe("durable recall lease store", () => {
  it("consumes conditionally and persists across reopen", async () => {
    const f = await fixture(); await f.store.put(lease(f.cursor));
    expect(await f.store.consume(f.cursor, "ls_test", { now: 10 })).toMatchObject({ remainingUses: 1 });
    await f.database.close();
    const db = await openWorkspaceSqliteStore({ dataRoot: f.root, workspaceId: f.cursor.workspaceId, busyTimeoutMs: 1000 });
    const reopened = openWorkspaceRecallLeaseStore({ database: db });
    expect(await reopened.consume(f.cursor, "ls_test", { now: 10 })).toMatchObject({ remainingUses: 0, status: "consumed" });
    await db.close();
  });
  it("fails closed on expiry and wrong cursor", async () => {
    const f = await fixture(); await f.store.put(lease(f.cursor, 5));
    expect(await f.store.consume(f.cursor, "ls_test", { now: 5 })).toBeNull();
    const wrong = { ...f.cursor, sessionId: "other" };
    expect(await f.store.consume(wrong, "ls_test", { now: 1 })).toBeNull();
    await f.database.close();
  });
  it("revokes and serializes concurrent consumption", async () => {
    const f = await fixture(); await f.store.put(lease(f.cursor, 1000, 1));
    const results = await Promise.all([f.store.consume(f.cursor, "ls_test", { now: 1 }), f.store.consume(f.cursor, "ls_test", { now: 1 })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await f.store.put(lease(f.cursor, 1000, 1, "ls_revoke"));
    expect(await f.store.revoke(f.cursor, "ls_revoke")).toBe(true);
    expect(await f.store.consume(f.cursor, "ls_revoke", { now: 1 })).toBeNull();
    await f.database.close();
  });
});
