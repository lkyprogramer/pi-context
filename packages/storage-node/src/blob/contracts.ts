import type { BlobStore } from "@pcr/runtime";

export type { BlobStore } from "@pcr/runtime";

export interface WorkspaceBlobKeyLease {
  readonly key: Uint8Array;
  destroy(): void;
}

export interface WorkspaceBlobKeyMaterial extends WorkspaceBlobKeyLease {
  readonly keyId: string;
}

export interface WorkspaceBlobKeyProvider {
  current(workspaceId: string): Promise<WorkspaceBlobKeyMaterial>;
  get(workspaceId: string, keyId: string): Promise<WorkspaceBlobKeyLease | null>;
}

export interface EncryptedBlobStoreDependencies {
  dataRoot: string;
  workspaceId: string;
  maxBlobBytes: number;
  keys: WorkspaceBlobKeyProvider;
}

export type EncryptedBlobStore = BlobStore;

export type BlobStoreErrorCode =
  | "PCR_BLOB_AUTH_FAILED"
  | "PCR_BLOB_INPUT_INVALID"
  | "PCR_BLOB_IO"
  | "PCR_BLOB_KEY_UNAVAILABLE"
  | "PCR_BLOB_NOT_FOUND"
  | "PCR_BLOB_RANGE_INVALID"
  | "PCR_BLOB_SCOPE_MISMATCH"
  | "PCR_BLOB_TAMPERED"
  | "PCR_BLOB_TOO_LARGE"
  | "PCR_BLOB_WORKSPACE_MISMATCH";

export class BlobStoreError extends Error {
  readonly code: BlobStoreErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: BlobStoreErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "BlobStoreError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function createWorkspaceBlobKeyLease(source: Uint8Array): WorkspaceBlobKeyLease {
  if (!(source instanceof Uint8Array) || source.byteLength !== 32) {
    throw new BlobStoreError("PCR_BLOB_KEY_UNAVAILABLE");
  }
  const key = Buffer.from(source);
  let destroyed = false;
  return Object.freeze({
    key,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      key.fill(0);
    },
  });
}

export function createWorkspaceBlobKeyMaterial(
  keyId: string,
  source: Uint8Array,
): WorkspaceBlobKeyMaterial {
  const lease = createWorkspaceBlobKeyLease(source);
  return Object.freeze({ keyId, key: lease.key, destroy: () => lease.destroy() });
}
