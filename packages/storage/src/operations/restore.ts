import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { decryptBackupArchive, opsError, sha256Bytes, type BackupReceipt } from "./backup.js";

export interface RestoreInput {
  targetRoot: string;
  backupKey: Buffer;
  liveRoot?: string;
}

export interface RestoreReceipt {
  verified: boolean;
  contextHead: string;
  targetRoot: string;
}

export async function restoreWorkspaceBackup(
  archive: string | BackupReceipt,
  input: RestoreInput,
): Promise<RestoreReceipt> {
  const archivePath = typeof archive === "string" ? archive : archive.archive;
  const target = resolve(input.targetRoot);
  if (input.liveRoot && resolve(input.liveRoot) === target) {
    throw opsError("PCR_RESTORE_OVERWRITES_LIVE");
  }
  if (existsSync(target)) {
    if (readdirSync(target).length > 0) throw opsError("PCR_RESTORE_TARGET_NOT_EMPTY");
  } else {
    mkdirSync(target, { recursive: true });
  }
  const opened = decryptBackupArchive(archivePath, input.backupKey);
  for (const entry of opened.manifest.files) {
    const bytes = opened.files[entry.rel];
    if (!bytes || sha256Bytes(bytes) !== entry.sha256) throw opsError("PCR_BACKUP_HASH_MISMATCH");
    const dest = join(target, entry.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes, { mode: 0o600 });
  }
  return { verified: true, contextHead: opened.manifest.contextHead, targetRoot: target };
}
