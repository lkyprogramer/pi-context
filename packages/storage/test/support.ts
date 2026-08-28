import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domainHash } from "../../contracts/src/index.js";
import { crashIf, InjectedCrash, type FaultPlan } from "../../testkit/src/fault-plan.js";
import { EncryptedBlobStore } from "../src/blob-store.js";
import { TestKeyProvider } from "../src/key-provider.js";
import type { HostJournalEntry, HostJournalView } from "../src/protocol.js";
import { SagaCoordinator } from "../src/saga.js";
import { openSqliteStore, type SqliteStore } from "../src/sqlite-store.js";

export async function createTestStore(input?: { path?: string; workspaceId?: string }): Promise<SqliteStore> {
  const path = input?.path ?? join(mkdtempSync(join(tmpdir(), "pcr-store-")), "store.sqlite");
  return openSqliteStore({ path, workspaceId: input?.workspaceId ?? "w1" });
}

export async function createTestBlobStore(input?: {
  root?: string;
  workspaceId?: string;
  key?: Buffer | null;
}): Promise<EncryptedBlobStore> {
  const root = input?.root ?? mkdtempSync(join(tmpdir(), "pcr-blobs-"));
  return new EncryptedBlobStore({
    root,
    workspaceId: input?.workspaceId ?? "w1",
    keys: new TestKeyProvider(input?.key === undefined ? Buffer.alloc(32, 7) : input.key),
  });
}

class MemoryHost implements HostJournalView {
  constructor(private readonly entries: HostJournalEntry[]) {}
  findByCorrelation(hostCorrelationId: string): HostJournalEntry | undefined {
    return this.entries.find((entry) => entry.hostCorrelationId === hostCorrelationId);
  }
  list(): HostJournalEntry[] {
    return [...this.entries];
  }
}

export interface RecoveryFixtureInput extends FaultPlan {
  hostOnly?: boolean;
  seedHost?: Partial<HostJournalEntry>;
  branchScope?: string;
}

export async function recoveryFixture(input: RecoveryFixtureInput): Promise<{
  reopenAndRecover(): Promise<void>;
  recoverAgain(): Promise<void>;
  operationState(): Promise<string>;
  countCommittedReceipts(): Promise<number>;
}> {
  const root = mkdtempSync(join(tmpdir(), "pcr-saga-"));
  const dbPath = join(root, "store.sqlite");
  const walDir = join(root, "wal");
  const workspaceId = "w1";
  mkdirSync(walDir, { recursive: true });
  let store = await openSqliteStore({ path: dbPath, workspaceId });
  const blobs = await createTestBlobStore({ root: join(root, "cas") });
  let coordinator = new SagaCoordinator(store, walDir);
  const hostEntries: HostJournalEntry[] = [];
  const host = new MemoryHost(hostEntries);
  const operationId = "op_recover_1";
  const plain = Buffer.from("full tool output");
  const hash = domainHash("observation", plain.toString("base64"));
  const hostCorrelationId = "call-1";
  const branchScope = input.branchScope ?? "main";

  const seed = (overlay?: Partial<HostJournalEntry>): void => {
    hostEntries.push({
      hostCorrelationId,
      contentHash: overlay?.contentHash ?? hash,
      hostRef: overlay?.hostRef ?? "host-1",
      branchScope: overlay?.branchScope ?? branchScope,
    });
  };

  try {
    if (input.hostOnly) {
      seed(input.seedHost);
    } else {
      await coordinator.prepare({
        operationId,
        kind: "observation",
        sourceContentHash: hash,
        hostCorrelationId,
        branchScope,
      });
      crashIf(input, "before-blob");
      const blob = await blobs.put(plain);
      await coordinator.prepare({
        operationId,
        kind: "observation",
        sourceContentHash: hash,
        hostCorrelationId,
        rawBlobId: blob.blobId,
        branchScope,
      });
      crashIf(input, "after-blob");
      crashIf(input, "before-descriptor");
      seed(input.seedHost);
      await coordinator.hostVisible(operationId, "host-1");
      crashIf(input, "host-visible");
      await coordinator.ack(operationId);
      await coordinator.commit(operationId);
    }
  } catch (error) {
    if (!(error instanceof InjectedCrash)) throw error;
    if (input.seedHost && !input.hostOnly && hostEntries.length === 0) {
      seed(input.seedHost);
    }
  }

  return {
    async reopenAndRecover() {
      await store.close();
      store = await openSqliteStore({ path: dbPath, workspaceId });
      coordinator = new SagaCoordinator(store, walDir);
      await coordinator.recover(host);
    },
    async recoverAgain() {
      await coordinator.recover(host);
    },
    async operationState() {
      return (await coordinator.getOperation(operationId))?.state ?? "absent";
    },
    async countCommittedReceipts() {
      return coordinator.countCommittedReceipts();
    },
  };
}
