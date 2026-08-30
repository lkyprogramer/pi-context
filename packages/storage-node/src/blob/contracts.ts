import type { BlobStore } from "@pcr/runtime";

export type { BlobStore } from "@pcr/runtime";

export interface WorkspaceBlobKeyMaterial {
  keyId: string;
  key: Uint8Array;
}

export interface WorkspaceBlobKeyProvider {
  current(workspaceId: string): Promise<WorkspaceBlobKeyMaterial>;
  get(workspaceId: string, keyId: string): Promise<Uint8Array | null>;
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
