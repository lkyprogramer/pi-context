import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  HostJournalView,
  RecoveryReport,
  SagaOperation,
  SagaPrepareInput,
  SagaState,
  StorageRpc,
} from "./protocol.js";
import { persistCommittedReceipt, reconcileHostWithoutReceipt, reconcileOperation } from "./recovery.js";

const RANK: Record<SagaState, number> = {
  prepared: 0,
  "host-visible": 1,
  acknowledged: 2,
  committed: 3,
  stale: 3,
  quarantined: 3,
};

const TERMINAL: ReadonlySet<SagaState> = new Set(["committed", "stale", "quarantined"]);

export type { SagaState } from "./protocol.js";

export class SagaCoordinator {
  constructor(
    private readonly store: StorageRpc,
    private readonly walDir: string,
  ) {
    mkdirSync(walDir, { recursive: true });
  }

  async prepare(input: SagaPrepareInput): Promise<SagaOperation> {
    const existing = await this.getOperation(input.operationId);
    if (existing) {
      if (existing.sourceContentHash !== input.sourceContentHash || existing.hostCorrelationId !== input.hostCorrelationId) {
        return this.advance(input.operationId, "quarantined");
      }
      if (!existing.rawBlobId && input.rawBlobId) {
        const next = { ...existing, rawBlobId: input.rawBlobId };
        await this.write(next);
        return next;
      }
      return existing;
    }
    const op: SagaOperation = {
      operationId: input.operationId,
      kind: input.kind,
      state: "prepared",
      sourceContentHash: input.sourceContentHash,
      hostCorrelationId: input.hostCorrelationId,
      branchScope: input.branchScope ?? "main",
      rawBlobId: input.rawBlobId,
    };
    await this.write(op);
    return op;
  }

  async hostVisible(operationId: string, hostRef: string): Promise<SagaOperation> {
    return this.advance(operationId, "host-visible", { hostRef });
  }

  async ack(operationId: string): Promise<SagaOperation> {
    return this.advance(operationId, "acknowledged");
  }

  async commit(operationId: string): Promise<SagaOperation> {
    const current = await this.require(operationId);
    if (current.state === "committed") return current;
    const receiptId = await persistCommittedReceipt(this.store, current);
    return this.advance(operationId, "committed", { receiptId });
  }

  async recover(host: HostJournalView): Promise<RecoveryReport> {
    const pending = await this.listNonTerminalOperations();
    const all = await this.listOperations();
    const actions = [];
    for (const op of pending) {
      actions.push(await reconcileOperation(op, host, (id, to, patch) => this.advance(id, to, patch)));
    }
    actions.push(...(await reconcileHostWithoutReceipt(host, all)));
    return { actions };
  }

  async getOperation(operationId: string): Promise<SagaOperation | null> {
    try {
      return JSON.parse(readFileSync(this.pathOf(operationId), "utf8")) as SagaOperation;
    } catch {
      return null;
    }
  }

  async listNonTerminalOperations(): Promise<SagaOperation[]> {
    return (await this.listOperations()).filter((op) => !TERMINAL.has(op.state));
  }

  async listOperations(): Promise<SagaOperation[]> {
    return readdirSync(this.walDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(join(this.walDir, name), "utf8")) as SagaOperation);
  }

  async countCommittedReceipts(): Promise<number> {
    let count = 0;
    for (const op of await this.listOperations()) {
      if (op.state !== "committed" || !op.receiptId) continue;
      if (await this.store.getEvidence(op.receiptId)) count += 1;
    }
    return count;
  }

  private async require(operationId: string): Promise<SagaOperation> {
    const op = await this.getOperation(operationId);
    if (!op) throw Object.assign(new Error("PCR_OPERATION_NOT_FOUND"), { code: "PCR_OPERATION_NOT_FOUND" });
    return op;
  }

  private async advance(operationId: string, to: SagaState, patch: Partial<SagaOperation> = {}): Promise<SagaOperation> {
    const current = await this.require(operationId);
    if (current.state === to) return { ...current, ...patch, state: to };
    if (TERMINAL.has(current.state)) return current;
    if (RANK[to] < RANK[current.state]) {
      throw Object.assign(new Error("PCR_SAGA_REGRESSION"), { code: "PCR_SAGA_REGRESSION" });
    }
    const next: SagaOperation = { ...current, ...patch, state: to };
    if (to === "committed") {
      next.receiptId = next.receiptId ?? (await persistCommittedReceipt(this.store, next));
    }
    await this.write(next);
    return next;
  }

  private pathOf(operationId: string): string {
    return join(this.walDir, `${operationId}.json`);
  }

  private async write(op: SagaOperation): Promise<void> {
    const dest = this.pathOf(op.operationId);
    const tmp = `${dest}.${process.pid}.spool`;
    writeFileSync(tmp, JSON.stringify(op), { mode: 0o600 });
    renameSync(tmp, dest);
  }
}
