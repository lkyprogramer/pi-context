import { describe, expect, it } from "vitest";

import { blobId, domainHash } from "@pcr/contracts";
import {
  planSagaRecovery,
  type HostSnapshot,
  type SagaRecord,
} from "@pcr/runtime";

const cursor = {
  workspaceId: `ws_${"a".repeat(40)}`,
  sessionId: "session-saga-plan",
  leafId: "leaf-saga-plan",
  lineageHash: "b".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

function record(seed: string, overrides: Partial<SagaRecord> = {}): SagaRecord {
  return {
    operationId: `operation-${seed}`,
    cursor,
    kind: "tool-result",
    sourceContentHash: domainHash("saga-plan-source", seed),
    hostCorrelationId: `correlation-${seed}`,
    rawBlobId: blobId(`blob_${domainHash("saga-plan-blob", seed)}`),
    configFingerprint: domainHash("saga-plan-config", "v1"),
    state: "runtime_durable",
    revision: 1,
    ...overrides,
  };
}

function snapshot(entries: HostSnapshot["entries"], overrides: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    cursor,
    configFingerprint: domainHash("saga-plan-config", "v1"),
    entries,
    ...overrides,
  };
}

describe("Saga recovery planner", () => {
  it("plans a host-backed commit without mutating its inputs", () => {
    const candidate = record("commit", { state: "host_visible", hostId: "host-commit" });
    const host = snapshot([{
      hostId: "host-commit",
      hostCorrelationId: candidate.hostCorrelationId,
      contentHash: candidate.sourceContentHash,
    }]);
    const before = structuredClone({ candidate, host });
    expect(planSagaRecovery([candidate], host)).toEqual({
      actions: [{
        operationId: candidate.operationId,
        from: "host_visible",
        to: "committed",
        reason: "host-visibility-recovered",
        hostId: "host-commit",
      }],
      transitions: [{ operationId: candidate.operationId, state: "committed", hostId: "host-commit" }],
    });
    expect({ candidate, host }).toEqual(before);
  });

  it("fences full cursor and config drift before consulting host content", () => {
    const candidate = record("stale");
    for (const current of [
      snapshot([], { cursor: { ...cursor, leafId: "other", lineageHash: "c".repeat(64) } }),
      snapshot([], { cursor: { ...cursor, modelKey: "openclaw/other" } }),
      snapshot([], { configFingerprint: "d".repeat(64) }),
    ]) {
      expect(planSagaRecovery([candidate], current).transitions).toEqual([
        { operationId: candidate.operationId, state: "stale" },
      ]);
    }
  });

  it("reports missing and host-only records without inventing transitions", () => {
    const candidate = record("missing");
    const plan = planSagaRecovery([candidate], snapshot([{
      hostId: "host-only",
      hostCorrelationId: "correlation-host-only",
      contentHash: "e".repeat(64),
    }]));
    expect(plan.transitions).toEqual([]);
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: candidate.operationId, reason: "host-entry-missing" }),
      expect.objectContaining({ operationId: "host-only", reason: "host-message-without-runtime-record" }),
    ]));
  });

  it("never reopens terminal records", () => {
    const terminal = [
      record("committed", { state: "committed" }),
      record("stale", { state: "stale" }),
      record("failed", { state: "failed" }),
    ];
    expect(planSagaRecovery(terminal, snapshot([]))).toEqual({ actions: [], transitions: [] });
  });
});
