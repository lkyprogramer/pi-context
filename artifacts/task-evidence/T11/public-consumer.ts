import type {
  DurableSagaJournal,
  HostSnapshot,
  RecoveryReport,
  SagaJournal,
  SagaOperation,
  SagaRecord,
} from "@pcr/runtime";
import {
  openWorkspaceSagaJournal,
  type WorkspaceSqliteEvidenceStore,
} from "@pcr/storage-node";

declare const database: WorkspaceSqliteEvidenceStore;
declare const operation: SagaOperation;
declare const snapshot: HostSnapshot;

const journalPromise: Promise<DurableSagaJournal> = openWorkspaceSagaJournal({
  database,
  async verifyBlob() {},
});

async function usePublicContract(journal: SagaJournal): Promise<[SagaRecord, RecoveryReport]> {
  const prepared = await journal.prepare(operation);
  await journal.markHostVisible(operation.operationId, "host-public");
  return [prepared, await journal.reconcile(snapshot)];
}

void journalPromise.then(usePublicContract);
