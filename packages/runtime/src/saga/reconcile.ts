import type {
  HostSnapshot,
  RecoveryAction,
  RecoveryReport,
  SagaRecord,
} from "./contracts.js";

function sameBranchAndModel(left: SagaRecord["cursor"], right: HostSnapshot["cursor"]): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export interface PlannedSagaRecovery extends RecoveryReport {
  transitions: Array<{ operationId: string; state: Extract<SagaRecord["state"], "committed" | "stale" | "failed">; hostId?: string }>;
}

export function planSagaRecovery(records: readonly SagaRecord[], snapshot: HostSnapshot): PlannedSagaRecovery {
  const byCorrelation = new Map(snapshot.entries.map((entry) => [entry.hostCorrelationId, entry]));
  const known = new Set(records.map((record) => record.hostCorrelationId));
  const actions: RecoveryAction[] = [];
  const transitions: PlannedSagaRecovery["transitions"] = [];

  for (const record of records) {
    if (record.state === "committed" || record.state === "stale" || record.state === "failed") continue;
    if (!sameBranchAndModel(record.cursor, snapshot.cursor) || record.configFingerprint !== snapshot.configFingerprint) {
      actions.push({ operationId: record.operationId, from: record.state, to: "stale", reason: "cursor-or-config-stale" });
      transitions.push({ operationId: record.operationId, state: "stale" });
      continue;
    }
    const entry = byCorrelation.get(record.hostCorrelationId);
    if (!entry) {
      actions.push({ operationId: record.operationId, from: record.state, to: record.state, reason: "host-entry-missing" });
      continue;
    }
    if (entry.contentHash !== record.sourceContentHash) {
      actions.push({ operationId: record.operationId, from: record.state, to: "failed", reason: "content-hash-mismatch", hostId: entry.hostId });
      transitions.push({ operationId: record.operationId, state: "failed", hostId: entry.hostId });
      continue;
    }
    if (record.hostId !== undefined && record.hostId !== entry.hostId) {
      actions.push({ operationId: record.operationId, from: record.state, to: "failed", reason: "host-id-mismatch", hostId: entry.hostId });
      transitions.push({ operationId: record.operationId, state: "failed", hostId: entry.hostId });
      continue;
    }
    actions.push({
      operationId: record.operationId,
      from: record.state,
      to: "committed",
      reason: "host-visibility-recovered",
      hostId: entry.hostId,
    });
    transitions.push({ operationId: record.operationId, state: "committed", hostId: entry.hostId });
  }

  for (const entry of snapshot.entries) {
    if (known.has(entry.hostCorrelationId)) continue;
    actions.push({
      operationId: entry.hostId,
      from: "absent",
      to: "absent",
      reason: "host-message-without-runtime-record",
      hostId: entry.hostId,
    });
  }
  return { actions, transitions };
}
