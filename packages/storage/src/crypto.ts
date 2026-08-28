import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { domainHash } from "../../contracts/src/index.js";

const ALGORITHM = "aes-256-gcm" as const;

export interface BlobEnvelopeV1 {
  version: 1;
  algorithm: "aes-256-gcm";
  workspaceId: string;
  plaintextHash: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

export function blobPlaintextHash(plain: Uint8Array): string {
  return domainHash("blob", Buffer.from(plain).toString("base64"));
}

export function deriveWorkspaceBlobKey(workspaceKey: Uint8Array, workspaceId: string, blobId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", workspaceKey, workspaceId, `pcr:blob-key:v1:${blobId}`, 32));
}

export function encryptAesGcm(
  plain: Uint8Array,
  workspaceKey: Uint8Array,
  blobId: string,
  workspaceId: string,
): Buffer {
  const key = deriveWorkspaceBlobKey(workspaceKey, workspaceId, blobId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(blobId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope: BlobEnvelopeV1 = {
    version: 1,
    algorithm: ALGORITHM,
    workspaceId,
    plaintextHash: blobPlaintextHash(plain),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function decryptAesGcm(
  raw: Uint8Array,
  workspaceKey: Uint8Array,
  blobId: string,
  workspaceId: string,
): Buffer {
  let envelope: BlobEnvelopeV1;
  try {
    envelope = JSON.parse(Buffer.from(raw).toString("utf8")) as BlobEnvelopeV1;
  } catch {
    throw Object.assign(new Error("PCR_BLOB_TAMPERED"), { code: "PCR_BLOB_TAMPERED" });
  }
  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw Object.assign(new Error("PCR_BLOB_TAMPERED"), { code: "PCR_BLOB_TAMPERED" });
  }
  if (envelope.workspaceId !== workspaceId) {
    throw Object.assign(new Error("PCR_BLOB_WORKSPACE_MISMATCH"), { code: "PCR_BLOB_WORKSPACE_MISMATCH" });
  }
  const key = deriveWorkspaceBlobKey(workspaceKey, workspaceId, blobId);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.nonce, "base64"));
    decipher.setAAD(Buffer.from(blobId, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    if (blobPlaintextHash(plain) !== envelope.plaintextHash) {
      throw Object.assign(new Error("PCR_BLOB_TAMPERED"), { code: "PCR_BLOB_TAMPERED" });
    }
    return plain;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    throw Object.assign(new Error("PCR_BLOB_AUTH_FAILED"), { code: "PCR_BLOB_AUTH_FAILED" });
  }
}
