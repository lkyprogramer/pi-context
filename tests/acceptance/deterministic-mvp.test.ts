import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createGateEngine } from "@pcr/benchmark";
import { createEvidenceService, createObservationService, createRecoveryService, createRuntimeSessionRegistry, planSagaRecovery } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceEvidenceRepository,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

import { registerProductionUserTurnRuntime } from "../../apps/pi-context-runtime/src/composition-root.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { createMvpAcceptance } from "../../scripts/gates/deterministic-mvp.mjs";
import { runW1Vertical } from "../../scripts/gates/w1-vertical.mjs";

const SCRATCH = "/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-14eb40de3fb3/implementer";
const EMPTY_DIFF = createHash("sha256").update("").digest("hex");
const roots: string[] = [];

afterEach(() => {
  resetOwnerForTest();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "t51-mvp-"));
  roots.push(root);
  return root;
}

function cursorFor(root: string) {
  return createRuntimeCursor({
    workspacePath: root,
    sessionId: "session-t51",
    leafId: "leaf-t51",
    lineageEntryIds: ["root", "leaf-t51"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function gateEngine(workspaceId: string) {
  return createGateEngine({
    workspaceId,
    git: {
      async status() {
        return { commit: "a".repeat(40), diffHash: EMPTY_DIFF, dirty: false };
      },
    },
    files: { async mkdir() { return; }, async writeFile() { return; } },
  });
}

function bundle(workspaceId: string, gate: "w1-early-net-value" | "w2-compactor") {
  return {
    runId: "run-t51",
    gate,
    workspaceId,
    integrity: {
      oracleValidity: 1,
      directiveCoverage: 1,
      toolPairViolations: 0,
      recoveryRate: 1,
      deterministicHashStable: true,
      leakCount: 0,
      unsupportedHighRisk: 0,
      crossScopeReads: 0,
    },
    continuation: { environmentSuccess: true },
    quality: { environmentSuccessLower: -0.01 },
    efficiency: {
      realizedNetMedian: 0.02,
      ingressTokenMedianDelta: -0.24,
      ingressTokenCiUpper: -0.12,
      hookP95Ms: 40,
      recallAt5: 0.95,
      recallPrecision: 0.82,
      silenceRate: 0.93,
      recallQualityCiLower: -0.005,
      recallNeededSuccessDelta: 0.04,
    },
    provenance: {
      commit: "a".repeat(40),
      diffHash: EMPTY_DIFF,
      dirty: false,
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      configDigest: "b".repeat(64),
    },
  };
}

describe("deterministic MVP acceptance", () => {
  it("returns one release-candidate verdict from real vertical, recovery, gates and product hooks", async () => {
    const root = dataRoot();
    const cursor = cursorFor(root);
    const key = Buffer.alloc(32, 51);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("key-t51", key); },
        async get(_workspaceId, keyId) {
          return keyId === "key-t51" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const saga = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
    });
    try {
      const hooks: string[] = [];
      const runtime = registerProductionUserTurnRuntime({
        on(name: string) {
          hooks.push(name);
          return () => undefined;
        },
      } as never, { dataRoot: () => root });
      const record = {
        operationId: "operation-t51",
        cursor,
        kind: "tool-result" as const,
        sourceContentHash: domainHash("t51-accept", "bytes"),
        hostCorrelationId: "tool-call-t51",
        rawBlobId: blobId(`blob_${domainHash("t51-blob", "bytes")}`),
        configFingerprint: domainHash("t51-config", { k: 1 }),
        state: "host_visible" as const,
        hostId: "host-t51",
        revision: 1,
      };
      const records = [record];
      const registry = createRuntimeSessionRegistry({
        workspaceId: cursor.workspaceId,
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
      const recovery = createRecoveryService({
        cursor,
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
      const engine = gateEngine(cursor.workspaceId);
      const mvp = createMvpAcceptance({
        workspaceId: cursor.workspaceId,
        vertical: {
          async probe() {
            const evidence = await runW1Vertical({
              cursor,
              observation: createObservationService({ cursor, blobs, saga }),
              evidence: createEvidenceService({
                cursor,
                repository: openWorkspaceEvidenceRepository({ database }),
                fts: openWorkspaceEvidenceFtsIndex({ database }),
                blobs,
              }),
              blobs,
              text: "cache invalidation strategy\nerror: boom\nexit code 1",
              operationId: "op-t51-vertical",
            });
            return evidence.exactReadHash === evidence.rawHash && evidence.visibleTokens > 0;
          },
        },
        recovery: {
          async probe() {
            const report = await recovery.onSessionStart({
              cursor,
              reason: "resume",
              hasRawBlobs: true,
              hostSnapshot: {
                cursor,
                configFingerprint: record.configFingerprint,
                entries: [{
                  hostId: record.hostId,
                  hostCorrelationId: record.hostCorrelationId,
                  contentHash: record.sourceContentHash,
                }],
              },
            });
            return report.catchUp.reason === "resume"
              && report.saga.actions.some((item: { to: string }) => item.to === "committed");
          },
        },
        w1: {
          async evaluate() {
            return engine.evaluate(bundle(cursor.workspaceId, "w1-early-net-value")).hardGatePass;
          },
        },
        w2: {
          async decide() {
            return engine.evaluate(bundle(cursor.workspaceId, "w2-compactor")).decision;
          },
        },
        findings: {
          async p0Open() {
            const f001 = hooks.includes("input") ? 0 : 1;
            const f002 = hooks.includes("tool_result") ? 0 : 1;
            return f001 + f002;
          },
        },
      });
      const verdict = await mvp.accept({ workspaceId: cursor.workspaceId });
      expect(verdict.vertical).toBe(true);
      expect(verdict.recovery).toBe(true);
      expect(verdict.w1Gate).toBe(true);
      expect(verdict.w2Decision.length).toBeGreaterThan(0);
      expect(verdict.p0Open).toBe(0);
      expect(hooks).toEqual(expect.arrayContaining(["tool_result", "input"]));
      await runtime.close();
    } finally {
      await saga.close();
      await database.close();
    }
  });
});
