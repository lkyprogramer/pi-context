import { closeSync, chmodSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { domainHash } from "../../contracts/src/index.js";
import { decryptAesGcm, encryptAesGcm, blobPlaintextHash } from "./crypto.js";
import type { KeyProvider } from "./key-provider.js";

function typedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function atomicWrite(dest: string, data: Uint8Array): void {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.spool`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, dest);
  chmodSync(dest, 0o600);
}

export class EncryptedBlobStore {
  constructor(
    private readonly opts: {
      root: string;
      workspaceId: string;
      keys: KeyProvider;
    },
  ) {}

  pathOf(blobId: string): string {
    const shard = blobId.replace(/^blob_/, "").slice(0, 2) || "00";
    return join(this.opts.root, "blobs", "sha256", shard, `${blobId}.bin`);
  }

  async ready(): Promise<void> {
    await this.opts.keys.ready();
  }

  async exists(blobId: string): Promise<boolean> {
    try {
      statSync(this.pathOf(blobId));
      return true;
    } catch {
      return false;
    }
  }

  async put(plain: Uint8Array): Promise<{ blobId: string; bytes: number }> {
    await this.ready();
    const blobId = `blob_${domainHash("blob", Buffer.from(plain).toString("base64"))}`;
    if (!(await this.exists(blobId))) {
      const envelope = encryptAesGcm(plain, await this.opts.keys.workspaceKey(), blobId, this.opts.workspaceId);
      atomicWrite(this.pathOf(blobId), envelope);
    }
    return { blobId, bytes: plain.byteLength };
  }

  async read(blobId: string): Promise<Buffer> {
    await this.ready();
    try {
      const raw = await readFile(this.pathOf(blobId));
      return decryptAesGcm(raw, await this.opts.keys.workspaceKey(), blobId, this.opts.workspaceId);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code === "ENOENT") throw typedError("PCR_BLOB_NOT_FOUND");
      throw error;
    }
  }

  async verify(blobId: string, plain: Uint8Array): Promise<void> {
    const got = await this.read(blobId);
    if (blobPlaintextHash(got) !== blobPlaintextHash(plain)) {
      throw typedError("PCR_BLOB_VERIFY_FAILED");
    }
  }

  async gcCandidate(referenced: Iterable<string>): Promise<string[]> {
    const keep = new Set(referenced);
    const removed: string[] = [];
    const root = join(this.opts.root, "blobs");
    for (const file of listBlobFiles(root)) {
      const blobId = file.name.replace(/\.bin$/, "");
      if (keep.has(blobId)) continue;
      unlinkSync(file.path);
      removed.push(blobId);
    }
    return removed;
  }
}

function listBlobFiles(root: string): { name: string; path: string }[] {
  try {
    statSync(root);
  } catch {
    return [];
  }
  const out: { name: string; path: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".bin")) out.push({ name: entry.name, path });
    }
  };
  walk(root);
  return out;
}
