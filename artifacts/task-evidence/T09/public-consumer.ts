import type { EvidenceRecord, RuntimeCursor } from "@pcr/contracts";
import {
  openWorkspaceSqliteStore,
  type EvidenceRepository,
  type OpenWorkspaceSqliteStoreInput,
  type WorkspaceSqliteEvidenceStore,
} from "@pcr/storage-node";

declare const input: OpenWorkspaceSqliteStoreInput;
declare const record: EvidenceRecord;
declare const cursor: RuntimeCursor;

const consume = async (): Promise<EvidenceRecord | null> => {
  const store: WorkspaceSqliteEvidenceStore = await openWorkspaceSqliteStore(input);
  const repository: EvidenceRepository = store;
  await repository.put(record);
  try {
    return await repository.get(cursor, record.evidenceId);
  } finally {
    await store.close();
  }
};

void consume;
