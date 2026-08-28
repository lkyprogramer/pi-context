import type { HostJournalView, RecoveryAction, SagaOperation, SagaState, StorageRpc } from "./protocol.js";

const TERMINAL: ReadonlySet<SagaState> = new Set(["committed", "stale", "quarantined"]);

export async function reconcileOperation(
  op: SagaOperation,
  host: HostJournalView,
  advance: (operationId: string, to: SagaState, patch?: Partial<SagaOperation>) => Promise<SagaOperation>,
): Promise<RecoveryAction> {
  if (TERMINAL.has(op.state)) {
    return { operationId: op.operationId, from: op.state, to: op.state, reason: "terminal" };
  }
  const entry = host.findByCorrelation(op.hostCorrelationId);
  if (!entry) {
    return { operationId: op.operationId, from: op.state, to: op.state, reason: op.rawBlobId ? "orphan-prepared" : "retry-prepared" };
  }
  if (entry.contentHash !== op.sourceContentHash) {
    await advance(op.operationId, "quarantined");
    return { operationId: op.operationId, from: op.state, to: "quarantined", reason: "content-hash-mismatch" };
  }
  if (entry.branchScope !== op.branchScope) {
    await advance(op.operationId, "stale");
    return { operationId: op.operationId, from: op.state, to: "stale", reason: "branch-ancestry-mismatch" };
  }
  if (op.state === "prepared") {
    await advance(op.operationId, "host-visible", { hostRef: entry.hostRef });
  }
  if (op.state === "prepared" || op.state === "host-visible") {
    await advance(op.operationId, "acknowledged");
  }
  await advance(op.operationId, "committed");
  return { operationId: op.operationId, from: op.state, to: "committed", reason: "host-ack-repaired" };
}

export async function reconcileHostWithoutReceipt(
  host: HostJournalView,
  operations: SagaOperation[],
): Promise<RecoveryAction[]> {
  const known = new Set(operations.map((op) => op.hostCorrelationId));
  const actions: RecoveryAction[] = [];
  for (const entry of host.list()) {
    if (known.has(entry.hostCorrelationId)) continue;
    actions.push({
      operationId: entry.hostRef,
      from: "absent",
      to: "absent",
      reason: "host-message-without-receipt",
    });
  }
  return actions;
}

export async function persistCommittedReceipt(store: StorageRpc, op: SagaOperation): Promise<string> {
  const receiptId = op.receiptId ?? `rcpt_${op.operationId}`;
  const existing = await store.getEvidence(receiptId);
  if (!existing) {
    await store.transaction(async (tx) => {
      await tx.putEvidence({ evidenceId: receiptId, contentHash: op.sourceContentHash });
    });
  }
  return receiptId;
}
