import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

import { blobId as toBlobId, canonicalJson, domainHash, type BlobRef, type RuntimeCursor } from "@pcr/contracts";

import { BlobStoreError } from "./contracts.js";

const ALGORITHM = "aes-256-gcm" as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface BlobEnvelopeV1 {
  version: 1;
  algorithm: typeof ALGORITHM;
  workspaceId: string;
  cursorHash: string;
  blobId: string;
  plaintextHash: string;
  bytes: number;
  keyId: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

export interface BlobIdentityV1 {
  cursorHash: string;
  plaintextHash: string;
  ref: BlobRef;
}

const ENVELOPE_KEYS = [
  "algorithm",
  "authTag",
  "blobId",
  "bytes",
  "ciphertext",
  "cursorHash",
  "keyId",
  "nonce",
  "plaintextHash",
  "version",
  "workspaceId",
].sort();

export function blobCursorHash(cursor: RuntimeCursor): string {
  return domainHash("blob-cursor", cursor);
}

export function scopedPlaintextHash(workspaceId: string, cursorHash: string, plain: Uint8Array): string {
  return createHash("sha256")
    .update("pcr:blob-plaintext:v1\0", "utf8")
    .update(workspaceId, "utf8")
    .update("\0", "utf8")
    .update(cursorHash, "utf8")
    .update("\0", "utf8")
    .update(plain)
    .digest("hex");
}

function aad(envelope: Pick<
  BlobEnvelopeV1,
  "version" | "algorithm" | "workspaceId" | "cursorHash" | "blobId" | "plaintextHash" | "bytes" | "keyId"
>): Buffer {
  return Buffer.from(canonicalJson({
    version: envelope.version,
    algorithm: envelope.algorithm,
    workspaceId: envelope.workspaceId,
    cursorHash: envelope.cursorHash,
    blobId: envelope.blobId,
    plaintextHash: envelope.plaintextHash,
    bytes: envelope.bytes,
    keyId: envelope.keyId,
  }), "utf8");
}

function deriveBlobKey(rootKey: Uint8Array, envelope: Pick<BlobEnvelopeV1, "workspaceId" | "blobId" | "keyId">): Buffer {
  const copy = Buffer.from(rootKey);
  try {
    return Buffer.from(
      hkdfSync(
        "sha256",
        copy,
        Buffer.from(envelope.workspaceId, "utf8"),
        Buffer.from(`pcr:blob-key:v1:${envelope.keyId}:${envelope.blobId}`, "utf8"),
        32,
      ),
    );
  } finally {
    copy.fill(0);
  }
}

function canonicalBase64(value: unknown, expectedBytes: number | undefined, field: string): Buffer {
  if (typeof value !== "string" || (value.length === 0 && expectedBytes !== 0)) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field });
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedBytes !== undefined && decoded.byteLength !== expectedBytes)) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field });
  }
  return decoded;
}

export function encodeEncryptedEnvelope(input: {
  identity: BlobIdentityV1;
  workspaceId: string;
  plain: Uint8Array;
  keyId: string;
  key: Uint8Array;
}): { ref: BlobRef; encoded: Buffer } {
  const { cursorHash, plaintextHash, ref } = input.identity;
  const header = {
    version: 1 as const,
    algorithm: ALGORITHM,
    workspaceId: input.workspaceId,
    cursorHash,
    blobId: ref,
    plaintextHash,
    bytes: input.plain.byteLength,
    keyId: input.keyId,
  };
  const key = deriveBlobKey(input.key, header);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    cipher.setAAD(aad(header));
    const ciphertext = Buffer.concat([cipher.update(input.plain), cipher.final()]);
    const envelope: BlobEnvelopeV1 = {
      ...header,
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return { ref, encoded: Buffer.from(canonicalJson(envelope), "utf8") };
  } finally {
    key.fill(0);
  }
}

export function parseEncryptedEnvelope(raw: Uint8Array): BlobEnvelopeV1 {
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope.json" }, { cause: error });
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope" });
  }
  const envelope = candidate as Partial<BlobEnvelopeV1>;
  if (Object.keys(envelope).sort().join("\0") !== ENVELOPE_KEYS.join("\0")) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope.keys" });
  }
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== ALGORITHM ||
    typeof envelope.workspaceId !== "string" ||
    typeof envelope.cursorHash !== "string" ||
    !HASH_PATTERN.test(envelope.cursorHash) ||
    typeof envelope.blobId !== "string" ||
    !/^blob_[a-f0-9]{64}$/u.test(envelope.blobId) ||
    typeof envelope.plaintextHash !== "string" ||
    !HASH_PATTERN.test(envelope.plaintextHash) ||
    envelope.blobId !== `blob_${envelope.plaintextHash}` ||
    !Number.isSafeInteger(envelope.bytes) ||
    (envelope.bytes ?? -1) < 0 ||
    typeof envelope.keyId !== "string" ||
    envelope.keyId.length === 0
  ) {
    throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope.header" });
  }
  canonicalBase64(envelope.nonce, 12, "envelope.nonce");
  canonicalBase64(envelope.authTag, 16, "envelope.authTag");
  const ciphertext = canonicalBase64(envelope.ciphertext, envelope.bytes, "envelope.ciphertext");
  ciphertext.fill(0);
  return envelope as BlobEnvelopeV1;
}

export function envelopeRef(envelope: BlobEnvelopeV1): BlobRef {
  return toBlobId(envelope.blobId);
}

export function blobIdentityForPlain(
  cursor: RuntimeCursor,
  workspaceId: string,
  plain: Uint8Array,
): BlobIdentityV1 {
  const cursorHash = blobCursorHash(cursor);
  const plaintextHash = scopedPlaintextHash(workspaceId, cursorHash, plain);
  return Object.freeze({ cursorHash, plaintextHash, ref: toBlobId(`blob_${plaintextHash}`) });
}

export function decryptEncryptedEnvelope(envelope: BlobEnvelopeV1, keyMaterial: Uint8Array): Buffer {
  const key = deriveBlobKey(keyMaterial, envelope);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, canonicalBase64(envelope.nonce, 12, "envelope.nonce"));
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(canonicalBase64(envelope.authTag, 16, "envelope.authTag"));
    let plain: Buffer;
    try {
      plain = Buffer.concat([
        decipher.update(canonicalBase64(envelope.ciphertext, envelope.bytes, "envelope.ciphertext")),
        decipher.final(),
      ]);
    } catch (error) {
      throw new BlobStoreError("PCR_BLOB_AUTH_FAILED", {}, { cause: error });
    }
    if (
      plain.byteLength !== envelope.bytes ||
      scopedPlaintextHash(envelope.workspaceId, envelope.cursorHash, plain) !== envelope.plaintextHash
    ) {
      plain.fill(0);
      throw new BlobStoreError("PCR_BLOB_TAMPERED", { field: "envelope.plaintextHash" });
    }
    return plain;
  } finally {
    key.fill(0);
  }
}
