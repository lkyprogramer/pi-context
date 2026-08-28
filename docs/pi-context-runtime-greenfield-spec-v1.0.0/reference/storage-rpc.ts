export interface StorageRpc {
  migrate(input: MigrationRequest, signal?: AbortSignal): Promise<MigrationReport>;
  executeCanonical(input: CanonicalTransaction, signal?: AbortSignal): Promise<CommitReceipt>;
  query<T extends TypedQuery>(input: T, signal?: AbortSignal): Promise<QueryResultFor<T>>;
  checkpoint(input: CheckpointRequest, signal?: AbortSignal): Promise<CheckpointReceipt>;
  close(signal?: AbortSignal): Promise<void>;
}
