import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createW1ArmRunner, type W1ArmCase, type W1IngressPort, type W1RecallPort } from "@pcr/benchmark";
import type { RuntimeCursor } from "@pcr/contracts";
import { createProductionReducers, createReducerRegistry, createRuntimeCursor } from "@pcr/core";
import { createEvidenceService, createObservationService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceEvidenceFtsIndex,
  openWorkspaceEvidenceRepository,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const SCRATCH = "/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-14eb40de3fb3/implementer";
const roots: string[] = [];
const RAW_TOOL = [
  `FILLER ${"x".repeat(80)}`,
  "progress 1",
  "progress 2",
  "progress 3",
  "progress 4",
  "error: boom",
  "exit code 1",
].join("\n");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "t42-live-"));
  roots.push(root);
  return root;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function openStack(root: string) {
  const cursor = createRuntimeCursor({
    workspacePath: root,
    sessionId: "session-t42-live",
    leafId: "leaf-t42-live",
    lineageEntryIds: ["root", "leaf-t42-live"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 42);
  const blobs = createEncryptedBlobStore({
    dataRoot: root,
    workspaceId: cursor.workspaceId,
    maxBlobBytes: 64 * 1024,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t42", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t42" ? createWorkspaceBlobKeyLease(key) : null;
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
  const observation = createObservationService({ cursor, blobs, saga });
  const evidence = createEvidenceService({
    cursor,
    repository: openWorkspaceEvidenceRepository({ database }),
    fts: openWorkspaceEvidenceFtsIndex({ database }),
    blobs,
  });
  const reducers = createReducerRegistry({ cursor, reducers: createProductionReducers() });
  return { cursor, blobs, database, saga, observation, evidence, reducers };
}

function liveIngress(
  cursor: RuntimeCursor,
  observation: ReturnType<typeof createObservationService>,
  evidence: ReturnType<typeof createEvidenceService>,
  reducers: ReturnType<typeof createReducerRegistry>,
): W1IngressPort {
  return {
    async ingest(input) {
      const projected = await observation.ingest({
        cursor,
        operationId: input.operationId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        args: {},
        content: [{ type: "text", text: input.text }],
        details: { exitCode: 1 },
        isError: true,
        capturedAt: input.capturedAt,
        sourceClass: "untrusted-tool",
        authority: "inform",
        signal: input.signal,
      });
      return {
        rawBlobId: projected.rawBlobId,
        operationId: projected.operationId,
        observationId: projected.observationId,
      };
    },
    async reduce(input) {
      const reduced = await reducers.reduce({
        cursor,
        text: input.text,
        rawBlobId: input.rawBlobId,
        observation: {
          cursor,
          operationId: `op_${input.toolCallId}`,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          args: {},
          content: [{ type: "text", text: input.text }],
          details: { exitCode: 1 },
          isError: true,
          capturedAt: 42,
          sourceClass: "untrusted-tool",
          authority: "inform",
          signal: input.signal,
        },
        signal: input.signal,
      });
      return { visibleText: reduced.visibleText, facts: reduced.facts, reducerId: reduced.reducer.id };
    },
    async admit(input) {
      const admitted = await evidence.admit({
        cursor,
        operationId: input.operationId,
        observationId: input.observationId,
        rawBlobId: input.rawBlobId as never,
        reducer: { id: input.reducerId, revision: "1" },
        sourceClass: "untrusted-tool",
        facts: input.facts.map((fact) => {
          const row = fact as { kind?: string; value?: unknown };
          return { kind: row.kind ?? "note", value: row.value ?? fact };
        }),
        observedAt: 42,
        visibleText: input.visibleText,
        signal: input.signal,
      });
      const evidenceId = admitted[0]?.evidenceId;
      if (!evidenceId) throw new Error("evidence.admit");
      return { evidenceId };
    },
    async readExact(input) {
      const page = await evidence.read({
        cursor,
        evidenceId: input.evidenceId,
        signal: input.signal,
      });
      return { sha256: page.sha256 };
    },
  };
}

function liveRecall(
  cursor: RuntimeCursor,
  evidence: ReturnType<typeof createEvidenceService>,
): W1RecallPort {
  return {
    async decide(input) {
      const hits = await evidence.search({
        cursor,
        text: input.userText,
        limit: 5,
        signal: input.signal,
      });
      return { quotes: hits.map((hit) => hit.snippet).filter((snippet): snippet is string => typeof snippet === "string") };
    },
  };
}

describe("W1 paired live arms", () => {
  it("runs A0/A1/A2 from the same raw trace through real CAS ingress", async () => {
    const root = dataRoot();
    const stack = await openStack(root);
    try {
      const record: W1ArmCase = {
        caseId: "tool-noise-05",
        clusterId: "tool-noise",
        corpusId: "pcr-bench",
        trace: {
          workspaceId: stack.cursor.workspaceId,
          sessionId: stack.cursor.sessionId,
          entries: [
            { entryId: "u1", role: "user", text: "fix the boom", workspaceId: stack.cursor.workspaceId, sessionId: stack.cursor.sessionId },
            { entryId: "t1", role: "toolResult", text: RAW_TOOL, workspaceId: stack.cursor.workspaceId, sessionId: stack.cursor.sessionId },
          ],
        },
        oracle: { items: [{ id: "error-1", key: "error", expected: "error: boom", sourceRefs: ["t1"] }] },
      };
      const runner = createW1ArmRunner({
        corpusId: "pcr-bench",
        manifest: {
          benchmarkMajor: 1,
          trainHash: "1".repeat(64),
          devHash: "2".repeat(64),
          lockedTestHash: "3".repeat(64),
          clusters: { "tool-noise": ["tool-noise-05"] },
        },
        cursor: stack.cursor,
        cases: { async get(caseId) { return caseId === record.caseId ? record : null; } },
        ingress: liveIngress(stack.cursor, stack.observation, stack.evidence, stack.reducers),
        recall: liveRecall(stack.cursor, stack.evidence),
      });
      const a0 = await runner.run(record.caseId, "A0", 7);
      const a1 = await runner.run(record.caseId, "A1", 7);
      const a2 = await runner.run(record.caseId, "A2", 7);
      expect(a0.sourceTraceHash).toBe(a1.sourceTraceHash);
      expect(a1.sourceTraceHash).toBe(a2.sourceTraceHash);
      expect(a0.compactor).toBe("pi-native");
      expect(a1.compactor).toBe("pi-native");
      expect(a2.compactor).toBe("pi-native");
      expect(a0.visibleText).toContain("FILLER");
      expect(a1.visibleText).not.toContain("FILLER");
      expect(a1.visibleText).toContain("error: boom");
      expect(a1.exactReadHash).toBe(sha256(RAW_TOOL));
      expect(a1.exactReadHash).toBe(a0.rawHash);
      expect(a1.ingress).toBe("w1");
      expect(a2.ingress).toBe("w1");
      expect(a1.recall).toBe("manual-only");
      expect(a2.recall).toBe("proactive");
    } finally {
      await stack.saga.close();
      await stack.database.close();
    }
  });
});
