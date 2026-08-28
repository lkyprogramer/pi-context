export interface StoredEvidence {
  evidenceId: string;
  contentHash: string;
  workspaceId: string;
}

export interface EvidencePut {
  evidenceId: string;
  contentHash: string;
}

export interface StorageTransaction {
  putEvidence(input: EvidencePut): Promise<void>;
}

export interface StorageRpc {
  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  getEvidence(id: string): Promise<StoredEvidence | null>;
  close(): Promise<void>;
}

export interface OpenStoreInput {
  path: string;
  workspaceId: string;
}
