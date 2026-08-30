import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  BlobStoreError,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  type WorkspaceBlobKeyLease,
  type WorkspaceBlobKeyMaterial,
  type WorkspaceBlobKeyProvider,
} from "./contracts.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const ENVIRONMENT_KEY = "PI_CONTEXT_RUNTIME_MASTER_KEY";

export interface OpenLocalWorkspaceBlobKeyProviderInput {
  dataRoot: string;
  workspaceId: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface LocalWorkspaceBlobKeyProvider extends WorkspaceBlobKeyProvider {
  readonly keyId: string;
  readonly source: "environment" | "local-file";
  close(): void;
}

function fail(field: string): never {
  throw new BlobStoreError("PCR_BLOB_KEY_UNAVAILABLE", { field });
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function ensurePrivateDirectory(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("keyDirectory");
  chmodSync(path, 0o700);
}

function strictBase64Key(value: string): Buffer {
  if (value.length === 0) fail(ENVIRONMENT_KEY);
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== value) {
    key.fill(0);
    fail(ENVIRONMENT_KEY);
  }
  return key;
}

function readSecureKey(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== 32 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      fail("masterKeyFile");
    }
    const key = readFileSync(fd);
    if (key.byteLength !== 32) fail("masterKeyFile");
    return key;
  } finally {
    closeSync(fd);
  }
}

function loadOrCreateKey(dataRoot: string, workspaceId: string): Buffer {
  const workspaceRoot = join(dataRoot, workspaceId);
  const stat = lstatSync(workspaceRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("workspaceRoot");
  const keysRoot = join(workspaceRoot, "keys");
  ensurePrivateDirectory(keysRoot);
  fsyncDirectory(workspaceRoot);
  const path = join(keysRoot, "master.key");
  try {
    return readSecureKey(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const generated = randomBytes(32);
  const temporary = join(keysRoot, `.master-${process.pid}-${randomBytes(12).toString("hex")}.spool`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let offset = 0;
    while (offset < generated.byteLength) {
      const written = writeSync(fd, generated, offset, generated.byteLength - offset);
      if (written <= 0) fail("masterKeyFile");
      offset += written;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(temporary, 0o600);
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      return readSecureKey(path);
    }
    fsyncDirectory(keysRoot);
    return Buffer.from(generated);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* crash-orphan spools are never treated as keys */ }
    generated.fill(0);
  }
}

class NodeLocalWorkspaceBlobKeyProvider implements LocalWorkspaceBlobKeyProvider {
  readonly keyId: string;
  readonly source: "environment" | "local-file";
  readonly #workspaceId: string;
  readonly #key: Buffer;
  #closed = false;

  constructor(input: OpenLocalWorkspaceBlobKeyProviderInput) {
    if (!input || typeof input !== "object") fail("dependencies");
    if (!isAbsolute(input.dataRoot)) fail("dataRoot");
    if (!WORKSPACE_PATTERN.test(input.workspaceId)) fail("workspaceId");
    this.#workspaceId = input.workspaceId;
    const encoded = (input.environment ?? process.env)[ENVIRONMENT_KEY];
    this.source = encoded === undefined ? "local-file" : "environment";
    try {
      this.#key = encoded === undefined
        ? loadOrCreateKey(input.dataRoot, input.workspaceId)
        : strictBase64Key(encoded);
    } catch (error) {
      if (error instanceof BlobStoreError) throw error;
      throw new BlobStoreError("PCR_BLOB_KEY_UNAVAILABLE", { field: "keySource" }, { cause: error });
    }
    this.keyId = `master-${createHash("sha256").update(this.#key).digest("hex").slice(0, 32)}`;
  }

  async current(workspaceId: string): Promise<WorkspaceBlobKeyMaterial> {
    this.#assertAvailable(workspaceId);
    return createWorkspaceBlobKeyMaterial(this.keyId, this.#key);
  }

  async get(workspaceId: string, keyId: string): Promise<WorkspaceBlobKeyLease | null> {
    this.#assertAvailable(workspaceId);
    return keyId === this.keyId ? createWorkspaceBlobKeyLease(this.#key) : null;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#key.fill(0);
  }

  #assertAvailable(workspaceId: string): void {
    if (this.#closed || workspaceId !== this.#workspaceId) fail("workspaceId");
  }
}

export function openLocalWorkspaceBlobKeyProvider(
  input: OpenLocalWorkspaceBlobKeyProviderInput,
): LocalWorkspaceBlobKeyProvider {
  return new NodeLocalWorkspaceBlobKeyProvider(input);
}
