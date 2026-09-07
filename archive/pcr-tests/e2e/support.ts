import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { createWorkspaceBackup, type BackupReceipt } from "../../packages/storage/src/operations/backup.js";
import { commitWorkspaceGc, planWorkspaceGc } from "../../packages/storage/src/operations/gc.js";
import { rotateWorkspaceKeys } from "../../packages/storage/src/operations/key-rotation.js";
import { restoreWorkspaceBackup } from "../../packages/storage/src/operations/restore.js";
import { openSqliteStore } from "../../packages/storage/src/sqlite-store.js";

export const T47_FIXTURE_SECRET = "sk-t47-omit-fixture-001";

export async function operationsFixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "pcr-ops-"));
  const workspaceId = "ws_t47";
  const originalContextHead = "ctx_t47_head";
  const workspaceKey = Buffer.alloc(32, 9);
  const backupKey = Buffer.alloc(32, 3);
  mkdirSync(join(workspaceRoot, "keys"), { recursive: true });
  writeFileSync(join(workspaceRoot, "pcr-workspace.json"), JSON.stringify({ workspaceId, contextHead: originalContextHead }));
  writeFileSync(join(workspaceRoot, "keys", "master.key"), T47_FIXTURE_SECRET);
  const store = await openSqliteStore({ path: join(workspaceRoot, "store.sqlite"), workspaceId });
  await store.transaction(async (tx) => {
    await tx.putEvidence({ evidenceId: "ev_t47", contentHash: "hash_t47" });
  });
  await store.close();
  const blobs = new EncryptedBlobStore({
    root: workspaceRoot,
    workspaceId,
    keys: new TestKeyProvider(workspaceKey),
  });
  const referenced = await blobs.put(Buffer.from("keep-ref"));
  const orphan = await blobs.put(Buffer.from("orphan-blob"));

  return {
    workspaceRoot,
    workspaceId,
    originalContextHead,
    backupKey,
    workspaceKey,
    referencedBlobId: referenced.blobId,
    orphanBlobId: orphan.blobId,
    async backup(): Promise<BackupReceipt> {
      return createWorkspaceBackup(
        { workspaceRoot, archivePath: join(mkdtempSync(join(tmpdir(), "pcr-bak-")), "workspace.bin") },
        { store: { async checkpoint() {} }, backupKey },
      );
    },
    async restoreToNewDirectory(archive: BackupReceipt | string) {
      const targetRoot = mkdtempSync(join(tmpdir(), "pcr-restore-"));
      return restoreWorkspaceBackup(archive, { targetRoot, backupKey, liveRoot: workspaceRoot });
    },
    restoreTo(targetRoot: string, archive: BackupReceipt | string) {
      return restoreWorkspaceBackup(archive, { targetRoot, backupKey, liveRoot: workspaceRoot });
    },
    gcDryRun() {
      return planWorkspaceGc(workspaceRoot, [referenced.blobId]);
    },
    gcCommit(plan: Awaited<ReturnType<typeof planWorkspaceGc>>, token: string) {
      return commitWorkspaceGc(plan, token);
    },
    rotate(input?: { crashAfter?: number; newKey?: Buffer }) {
      return rotateWorkspaceKeys({
        workspaceRoot,
        workspaceId,
        oldKey: workspaceKey,
        newKey: input?.newKey ?? Buffer.alloc(32, 11),
        crashAfter: input?.crashAfter,
      });
    },
  };
}
