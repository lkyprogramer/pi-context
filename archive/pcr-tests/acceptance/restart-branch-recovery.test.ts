import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import {
  createRecoveryService,
  createRuntimeSessionRegistry,
  planSagaRecovery,
  type HostSnapshot,
  type SagaRecord,
} from "@pcr/runtime";

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

describe("restart and branch recovery", () => {
  it("recovers a host-visible saga on resume using the derived session cursor", async () => {
    const bound = createRuntimeCursor({
      workspacePath: WORK,
      sessionId: "session-accept-t32",
      leafId: "leaf-accept-t32",
      lineageEntryIds: ["root", "leaf-accept-t32"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const record: SagaRecord = {
      operationId: "operation-accept-t32",
      cursor: bound,
      kind: "tool-result",
      sourceContentHash: domainHash("t32-accept", "bytes"),
      hostCorrelationId: "tool-call-accept",
      rawBlobId: blobId(`blob_${domainHash("t32-accept-blob", "bytes")}`),
      configFingerprint: domainHash("t32-accept-config", { k: 1 }),
      state: "host_visible",
      hostId: "host-accept",
      revision: 1,
    };
    const snapshot: HostSnapshot = {
      cursor: bound,
      configFingerprint: record.configFingerprint,
      entries: [{
        hostId: "host-accept",
        hostCorrelationId: record.hostCorrelationId,
        contentHash: record.sourceContentHash,
      }],
    };
    const records = [record];
    const registry = createRuntimeSessionRegistry({
      workspaceId: bound.workspaceId,
      factory: {
        async create() {
          return {
            session: {
              async ingestUserInput() { throw new Error("unused"); },
              async ingestToolResult() { throw new Error("unused"); },
              async materialize() { throw new Error("unused"); },
            },
            dispose: async () => undefined,
          };
        },
      },
    });
    const service = createRecoveryService({
      cursor: bound,
      sessions: registry,
      journal: {
        async reconcile(host) {
          const plan = planSagaRecovery(records, host);
          for (const transition of plan.transitions) {
            const row = records.find((item) => item.operationId === transition.operationId);
            if (row) row.state = transition.state;
          }
          return { actions: plan.actions };
        },
      },
      candidates: { async invalidate() { return 1; } },
    });
    const report = await service.onSessionStart({
      cursor: bound,
      reason: "resume",
      hasRawBlobs: true,
      hostSnapshot: snapshot,
    });
    expect(report.cursor).toEqual(bound);
    expect(report.catchUp.reason).toBe("resume");
    expect(report.saga.actions.some((item) => item.to === "committed")).toBe(true);
    expect(report.cursor.sessionId).not.toBe("s1");
  });
});
