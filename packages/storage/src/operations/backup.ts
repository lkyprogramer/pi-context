import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { domainHash } from "../../../contracts/src/index.js";
import { decryptAesGcm, encryptAesGcm } from "../crypto.js";

const BACKUP_WORKSPACE = "pcr-backup";
const BACKUP_BLOB_ID = "backup_archive";

export interface BackupInput {
  workspaceRoot: string;
  archivePath?: string;
}

export interface OperationDeps {
  store: { checkpoint(): Promise<void> };
  backupKey: Buffer;
}

export interface BackupFileEntry {
  rel: string;
  sha256: string;
  bytes: number;
}

export interface BackupManifest {
  version: 1;
  workspaceId: string;
  contextHead: string;
  files: BackupFileEntry[];
}

export interface BackupReceipt {
  archive: string;
  manifestHash: string;
  manifest: BackupManifest;
}

export interface WorkspaceMeta {
  workspaceId: string;
  contextHead: string;
}

export function opsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function isExcludedFromBackup(rel: string): boolean {
  const norm = rel.replaceAll("\\", "/");
  if (norm === "keys" || norm.startsWith("keys/")) return true;
  if (/(^|\/)[^/]+\.key$/.test(norm)) return true;
  return false;
}

export function readWorkspaceMeta(workspaceRoot: string): WorkspaceMeta {
  const path = join(workspaceRoot, "pcr-workspace.json");
  if (!existsSync(path)) throw opsError("PCR_WORKSPACE_META_MISSING");
  return JSON.parse(readFileSync(path, "utf8")) as WorkspaceMeta;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function listWorkspaceFiles(workspaceRoot: string): Array<{ rel: string; bytes: Buffer }> {
  const out: Array<{ rel: string; bytes: Buffer }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(workspaceRoot, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (!isExcludedFromBackup(rel)) walk(path);
        continue;
      }
      if (isExcludedFromBackup(rel)) continue;
      out.push({ rel, bytes: readFileSync(path) });
    }
  };
  walk(workspaceRoot);
  return out.sort((left, right) => left.rel.localeCompare(right.rel));
}

export async function buildBackupManifest(workspaceRoot: string, _deps: OperationDeps): Promise<BackupManifest> {
  const meta = readWorkspaceMeta(workspaceRoot);
  const files = listWorkspaceFiles(workspaceRoot).map((file) => ({
    rel: file.rel,
    sha256: sha256Bytes(file.bytes),
    bytes: file.bytes.byteLength,
  }));
  return {
    version: 1,
    workspaceId: meta.workspaceId,
    contextHead: meta.contextHead,
    files,
  };
}

export async function writeEncryptedArchive(
  manifest: BackupManifest,
  backupKey: Buffer,
  files: Array<{ rel: string; bytes: Buffer }>,
  dest: string,
): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({
      manifest,
      files: Object.fromEntries(files.map((file) => [file.rel, file.bytes.toString("base64")])),
    }),
    "utf8",
  );
  const envelope = encryptAesGcm(payload, backupKey, BACKUP_BLOB_ID, BACKUP_WORKSPACE);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, envelope, { mode: 0o600 });
  return dest;
}

export function decryptBackupArchive(
  archive: string,
  backupKey: Buffer,
): { manifest: BackupManifest; files: Record<string, Buffer> } {
  const plain = decryptAesGcm(readFileSync(archive), backupKey, BACKUP_BLOB_ID, BACKUP_WORKSPACE);
  const parsed = JSON.parse(plain.toString("utf8")) as {
    manifest: BackupManifest;
    files: Record<string, string>;
  };
  return {
    manifest: parsed.manifest,
    files: Object.fromEntries(Object.entries(parsed.files).map(([rel, encoded]) => [rel, Buffer.from(encoded, "base64")])),
  };
}

export async function verifyArchive(archive: string, manifest: BackupManifest, backupKey: Buffer): Promise<void> {
  const opened = decryptBackupArchive(archive, backupKey);
  if (opened.manifest.contextHead !== manifest.contextHead) throw opsError("PCR_BACKUP_MANIFEST_MISMATCH");
  for (const entry of manifest.files) {
    const bytes = opened.files[entry.rel];
    if (!bytes || sha256Bytes(bytes) !== entry.sha256) throw opsError("PCR_BACKUP_HASH_MISMATCH");
  }
}

export async function createWorkspaceBackup(input: BackupInput, deps: OperationDeps): Promise<BackupReceipt> {
  await deps.store.checkpoint();
  const files = listWorkspaceFiles(input.workspaceRoot);
  const manifest = await buildBackupManifest(input.workspaceRoot, deps);
  const dest =
    input.archivePath ??
    join(dirname(input.workspaceRoot), "backups", `pcr-${manifest.workspaceId}-${manifest.contextHead}.bin`);
  const archive = await writeEncryptedArchive(manifest, deps.backupKey, files, dest);
  await verifyArchive(archive, manifest, deps.backupKey);
  return { archive, manifestHash: domainHash("backup-manifest", manifest), manifest };
}
