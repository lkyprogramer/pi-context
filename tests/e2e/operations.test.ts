import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleOperationsCommand } from "../../apps/pi-context-runtime/src/commands/operations.js";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { decryptBackupArchive } from "../../packages/storage/src/operations/backup.js";
import { readRotationState } from "../../packages/storage/src/operations/key-rotation.js";
import { operationsFixture, T47_FIXTURE_SECRET } from "./support.js";

describe("operations", () => {
  it("restores into a new empty directory and verifies every manifest hash", async () => {
    const fx = await operationsFixture();
    const archive = await fx.backup();
    const restored = await fx.restoreToNewDirectory(archive);
    expect(restored.verified).toBe(true);
    expect(restored.contextHead).toBe(fx.originalContextHead);
  });

  it("never overwrites a live workspace directory", async () => {
    const fx = await operationsFixture();
    const archive = await fx.backup();
    await expect(fx.restoreTo(fx.workspaceRoot, archive)).rejects.toMatchObject({ code: "PCR_RESTORE_OVERWRITES_LIVE" });
  });

  it("plans GC exactly and keeps referenced blobs", async () => {
    const fx = await operationsFixture();
    const plan = await fx.gcDryRun();
    expect(plan.candidates).toEqual([fx.orphanBlobId]);
    expect(plan.candidates).not.toContain(fx.referencedBlobId);
    await expect(fx.gcCommit(plan, "wrong-token")).rejects.toMatchObject({ code: "PCR_GC_TOKEN_MISMATCH" });
    const committed = await fx.gcCommit(plan, plan.confirmationToken);
    expect(committed.removed).toEqual([fx.orphanBlobId]);
    const blobs = new EncryptedBlobStore({
      root: fx.workspaceRoot,
      workspaceId: fx.workspaceId,
      keys: new TestKeyProvider(fx.workspaceKey),
    });
    expect(await blobs.read(fx.referencedBlobId)).toEqual(Buffer.from("keep-ref"));
    await expect(blobs.read(fx.orphanBlobId)).rejects.toMatchObject({ code: "PCR_BLOB_NOT_FOUND" });
  });

  it("resumes key rotation after a crash using the dual key set", async () => {
    const fx = await operationsFixture();
    const newKey = Buffer.alloc(32, 11);
    await expect(fx.rotate({ crashAfter: 1, newKey })).rejects.toMatchObject({ code: "PCR_ROTATION_CRASH" });
    const mid = readRotationState(fx.workspaceRoot);
    expect(mid?.phase).toBe("dual");
    expect((mid?.remaining.length ?? 0) + (mid?.done.length ?? 0)).toBeGreaterThan(0);
    const done = await fx.rotate({ newKey });
    expect(done.phase).toBe("new");
    expect(done.remaining).toBe(0);
    const blobs = new EncryptedBlobStore({
      root: fx.workspaceRoot,
      workspaceId: fx.workspaceId,
      keys: new TestKeyProvider(newKey),
    });
    expect(await blobs.read(fx.referencedBlobId)).toEqual(Buffer.from("keep-ref"));
  });

  it("excludes plaintext key material from the encrypted backup", async () => {
    const fx = await operationsFixture();
    const archive = await fx.backup();
    const raw = readFileSync(archive.archive);
    expect(raw.toString("utf8")).not.toContain(T47_FIXTURE_SECRET);
    expect(existsSync(join(fx.workspaceRoot, "keys", "master.key"))).toBe(true);
    expect(archive.manifest.files.some((file) => file.rel.startsWith("keys/"))).toBe(false);
    const opened = decryptBackupArchive(archive.archive, fx.backupKey);
    expect(Object.keys(opened.files).some((rel) => rel.startsWith("keys/"))).toBe(false);
    expect(JSON.stringify(opened)).not.toContain(T47_FIXTURE_SECRET);
  });

  it("exposes doctor and recover commands without calling an LLM", async () => {
    const fx = await operationsFixture();
    const doctor = await handleOperationsCommand("doctor", {}, { workspaceId: fx.workspaceId, workspaceRoot: fx.workspaceRoot });
    const recover = await handleOperationsCommand("recover", {}, { workspaceId: fx.workspaceId, workspaceRoot: fx.workspaceRoot });
    expect(JSON.parse(doctor)).toMatchObject({ command: "context-doctor", ready: true });
    expect(JSON.parse(recover)).toMatchObject({ command: "context-recover", verified: true });
    expect(doctor).not.toContain(T47_FIXTURE_SECRET);
  });
});
