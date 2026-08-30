import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { constants as bufferConstants } from "node:buffer";
import { isAbsolute, join } from "node:path";

import type { BlobRef, ByteRange, RuntimeCursor } from "@pcr/contracts";

import type {
  BlobStore,
  EncryptedBlobStoreDependencies,
  WorkspaceBlobKeyLease,
} from "./contracts.js";
import { BlobStoreError } from "./contracts.js";
import {
  blobCursorHash,
  blobIdentityForPlain,
  decryptEncryptedEnvelope,
  encodeEncryptedEnvelope,
  envelopeRef,
  parseEncryptedEnvelope,
} from "./crypto.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BLOB_REF_PATTERN = /^blob_[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ENVELOPE_OVERHEAD_BYTES = 16 * 1024;
export const MAX_ENCRYPTED_JSON_BLOB_BYTES = Math.floor(
  (bufferConstants.MAX_STRING_LENGTH - ENVELOPE_OVERHEAD_BYTES) / 4,
) * 3;

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (code === undefined || (error as NodeJS.ErrnoException).code === code);
}

function ioError(error: unknown, operation: string): BlobStoreError {
  if (error instanceof BlobStoreError) return error;
  return new BlobStoreError("PCR_BLOB_IO", { operation }, { cause: error });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field });
  }
}

function validateCursor(cursor: RuntimeCursor, workspaceId: string): Readonly<RuntimeCursor> {
  if (!cursor || typeof cursor !== "object") {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "cursor" });
  }
  const snapshot: RuntimeCursor = {
    workspaceId: cursor.workspaceId,
    sessionId: cursor.sessionId,
    leafId: cursor.leafId,
    lineageHash: cursor.lineageHash,
    modelKey: cursor.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(snapshot.workspaceId)) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "cursor.workspaceId" });
  }
  requireNonEmpty(snapshot.sessionId, "cursor.sessionId");
  if (snapshot.leafId !== null) requireNonEmpty(snapshot.leafId, "cursor.leafId");
  if (!SHA256_PATTERN.test(snapshot.lineageHash)) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "cursor.lineageHash" });
  }
  requireNonEmpty(snapshot.modelKey, "cursor.modelKey");
  if (snapshot.workspaceId !== workspaceId) {
    throw new BlobStoreError("PCR_BLOB_WORKSPACE_MISMATCH");
  }
  return Object.freeze(snapshot);
}

function validateRef(ref: BlobRef): BlobRef {
  if (typeof ref !== "string" || !BLOB_REF_PATTERN.test(ref)) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "ref" });
  }
  return ref;
}

function validateRangeShape(range: ByteRange | undefined): ByteRange | undefined {
  if (range === undefined) return undefined;
  if (
    !range ||
    typeof range !== "object" ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endExclusive) ||
    range.start < 0 ||
    range.endExclusive < range.start
  ) {
    throw new BlobStoreError("PCR_BLOB_RANGE_INVALID");
  }
  return Object.freeze({ start: range.start, endExclusive: range.endExclusive });
}

function validateKeyId(keyId: unknown): asserts keyId is string {
  if (typeof keyId !== "string" || !KEY_ID_PATTERN.test(keyId)) {
    throw new BlobStoreError("PCR_BLOB_KEY_UNAVAILABLE");
  }
}

interface AcquiredKey {
  readonly key: Buffer;
  destroy(): void;
}

function acquireKey(lease: WorkspaceBlobKeyLease | null): AcquiredKey {
  if (
    !lease
    || !(lease.key instanceof Uint8Array)
    || lease.key.byteLength !== 32
    || typeof lease.destroy !== "function"
  ) {
    lease?.destroy?.();
    throw new BlobStoreError("PCR_BLOB_KEY_UNAVAILABLE");
  }
  const key = Buffer.from(lease.key);
  let destroyed = false;
  return {
    key,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        key.fill(0);
      } finally {
        lease.destroy();
      }
    },
  };
}

function assertDirectory(path: string, operation: string, enforcePrivateMode: boolean): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw ioError(error, operation);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new BlobStoreError("PCR_BLOB_IO", { operation });
  }
  if (enforcePrivateMode) {
    try {
      chmodSync(path, 0o700);
    } catch (error) {
      throw ioError(error, operation);
    }
    fsyncDirectory(path);
  }
}

function ensurePrivateDirectory(path: string, operation: string): void {
  try {
    mkdirSync(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw ioError(error, operation);
  }
  assertDirectory(path, operation, true);
}

function ensureStorageLayout(dataRoot: string, workspaceId: string): { workspaceRoot: string; casRoot: string } {
  if (!isAbsolute(dataRoot)) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "dataRoot" });
  }
  if (!WORKSPACE_PATTERN.test(workspaceId)) {
    throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "workspaceId" });
  }
  assertDirectory(dataRoot, "validate-data-root", false);
  const workspaceRoot = join(dataRoot, workspaceId);
  const blobsRoot = join(workspaceRoot, "blobs");
  const casRoot = join(blobsRoot, "sha256");
  ensurePrivateDirectory(workspaceRoot, "validate-workspace-root");
  fsyncDirectory(dataRoot);
  ensurePrivateDirectory(blobsRoot, "validate-blobs-root");
  fsyncDirectory(workspaceRoot);
  ensurePrivateDirectory(casRoot, "validate-cas-root");
  fsyncDirectory(blobsRoot);
  return { workspaceRoot, casRoot };
}

function fsyncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY);
    fsyncSync(fd);
  } catch (error) {
    throw ioError(error, "fsync-directory");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new BlobStoreError("PCR_BLOB_IO", { operation: "write-spool" });
    offset += written;
  }
}

function publishNoOverwrite(directory: string, destination: string, bytes: Uint8Array): boolean {
  const spool = join(directory, `.blob-${process.pid}-${randomBytes(16).toString("hex")}.spool`);
  let fd: number | undefined;
  let linked = false;
  try {
    fd = openSync(
      spool,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      linkSync(spool, destination);
      linked = true;
      chmodSync(destination, 0o600);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }
    unlinkSync(spool);
    fsyncDirectory(directory);
    return linked;
  } catch (error) {
    throw ioError(error, "publish-blob");
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* preserve the primary failure */ }
    }
    if (existsSync(spool)) {
      try { unlinkSync(spool); } catch { /* a later retry ignores orphan spool files */ }
    }
  }
}

function readSecureFile(path: string, maxEnvelopeBytes: number): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "blob.file" });
    }
    if (stat.size <= 0 || stat.size > maxEnvelopeBytes) {
      throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "blob.size" });
    }
    return readFileSync(fd);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new BlobStoreError("PCR_BLOB_NOT_FOUND");
    if (isNodeError(error, "ELOOP")) throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "blob.file" });
    throw ioError(error, "read-blob");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

class NodeEncryptedBlobStore implements BlobStore {
  readonly #workspaceId: string;
  readonly #casRoot: string;
  readonly #maxBlobBytes: number;
  readonly #maxEnvelopeBytes: number;
  readonly #keys: EncryptedBlobStoreDependencies["keys"];

  constructor(input: EncryptedBlobStoreDependencies) {
    if (!input || typeof input !== "object") {
      throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "dependencies" });
    }
    if (
      !Number.isSafeInteger(input.maxBlobBytes)
      || input.maxBlobBytes <= 0
      || input.maxBlobBytes > MAX_ENCRYPTED_JSON_BLOB_BYTES
    ) {
      throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "maxBlobBytes" });
    }
    if (!input.keys || typeof input.keys.current !== "function" || typeof input.keys.get !== "function") {
      throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "keys" });
    }
    const { casRoot } = ensureStorageLayout(input.dataRoot, input.workspaceId);
    this.#workspaceId = input.workspaceId;
    this.#casRoot = casRoot;
    this.#maxBlobBytes = input.maxBlobBytes;
    this.#maxEnvelopeBytes = Math.ceil(input.maxBlobBytes * 4 / 3) + ENVELOPE_OVERHEAD_BYTES;
    this.#keys = input.keys;
  }

  #pathOf(ref: BlobRef): { directory: string; path: string } {
    const hash = ref.slice("blob_".length);
    const directory = join(this.#casRoot, hash.slice(0, 2));
    return { directory, path: join(directory, `${ref}.bin`) };
  }

  #ensureShard(directory: string): void {
    try {
      mkdirSync(directory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw ioError(error, "create-shard");
    }
    assertDirectory(directory, "validate-shard", true);
    fsyncDirectory(this.#casRoot);
  }

  async put(cursorInput: RuntimeCursor, plainInput: Uint8Array): Promise<BlobRef> {
    const cursor = validateCursor(cursorInput, this.#workspaceId);
    if (!(plainInput instanceof Uint8Array)) {
      throw new BlobStoreError("PCR_BLOB_INPUT_INVALID", { field: "plain" });
    }
    if (plainInput.byteLength > this.#maxBlobBytes) throw new BlobStoreError("PCR_BLOB_TOO_LARGE");
    const plain = Buffer.from(plainInput);
    try {
      const identity = blobIdentityForPlain(cursor, this.#workspaceId, plain);
      const ref = identity.ref;
      const { directory, path } = this.#pathOf(ref);
      this.#ensureShard(directory);
      if (existsSync(path)) {
        const existing = Buffer.from(await this.read(cursor, ref));
        try {
          if (existing.byteLength !== plain.byteLength || !timingSafeEqual(existing, plain)) {
            throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "blob.collision" });
          }
          fsyncDirectory(directory);
          return ref;
        } finally {
          existing.fill(0);
        }
      }

      const material = await this.#keys.current(this.#workspaceId);
      const keyId = material?.keyId;
      try {
        validateKeyId(keyId);
      } catch (error) {
        material?.destroy?.();
        throw error;
      }
      const acquired = acquireKey(material);
      let encoded: Buffer;
      try {
        encoded = encodeEncryptedEnvelope({
          identity,
          workspaceId: this.#workspaceId,
          plain,
          keyId,
          key: acquired.key,
        }).encoded;
      } finally {
        acquired.destroy();
      }
      let won: boolean;
      try {
        won = publishNoOverwrite(directory, path, encoded);
      } finally {
        encoded.fill(0);
      }
      if (!won) {
        const existing = Buffer.from(await this.read(cursor, ref));
        try {
          if (existing.byteLength !== plain.byteLength || !timingSafeEqual(existing, plain)) {
            throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "blob.collision" });
          }
        } finally {
          existing.fill(0);
        }
      }
      return ref;
    } finally {
      plain.fill(0);
    }
  }

  async read(cursorInput: RuntimeCursor, refInput: BlobRef, rangeInput?: ByteRange): Promise<Uint8Array> {
    const cursor = validateCursor(cursorInput, this.#workspaceId);
    const ref = validateRef(refInput);
    const range = validateRangeShape(rangeInput);
    const { path } = this.#pathOf(ref);
    const raw = readSecureFile(path, this.#maxEnvelopeBytes);
    try {
      const envelope = parseEncryptedEnvelope(raw);
      if (envelope.workspaceId !== this.#workspaceId || envelope.cursorHash !== blobCursorHash(cursor)) {
        throw new BlobStoreError("PCR_BLOB_SCOPE_MISMATCH");
      }
      if (envelopeRef(envelope) !== ref || envelope.bytes > this.#maxBlobBytes) {
        throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope.ref" });
      }
      validateKeyId(envelope.keyId);
      const acquired = acquireKey(await this.#keys.get(this.#workspaceId, envelope.keyId));
      try {
        const plain = decryptEncryptedEnvelope(envelope, acquired.key);
        if (range && range.endExclusive > plain.byteLength) {
          plain.fill(0);
          throw new BlobStoreError("PCR_BLOB_RANGE_INVALID");
        }
        if (!range) return plain;
        const selected = Buffer.from(plain.subarray(range.start, range.endExclusive));
        plain.fill(0);
        return selected;
      } finally {
        acquired.destroy();
      }
    } finally {
      raw.fill(0);
    }
  }
}

export function createEncryptedBlobStore(input: EncryptedBlobStoreDependencies): BlobStore {
  return new NodeEncryptedBlobStore(input);
}
