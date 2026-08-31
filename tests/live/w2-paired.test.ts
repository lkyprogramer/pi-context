import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createW2ArmRunner,
  type W1ArmCase,
  type W2NativeCompactor,
  type W2PcrCompactor,
  type W2TraceShaper,
} from "@pcr/benchmark";
import { blobId, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import {
  createCheckpointRenderer,
  createCheckpointVerifier,
  createClauseSegmenter,
  createDirectiveExtractor,
  createRuntimeCursor,
  type ContinuityRevision,
  type ContinuityStore,
} from "@pcr/core";
import {
  createCompactionService,
  createCompactionSnapshotAssembler,
  createContinuityService,
  createDirectiveService,
  type CompactionClaim,
  type CompactionPointer,
  type DirectiveRecordStore,
} from "@pcr/runtime";


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
  const root = mkdtempSync(join(tmpdir(), "t43-live-"));
  roots.push(root);
  return root;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function liveShaper(): W2TraceShaper {
  return {
    async shape(input) {
      const shapedText = input.trace.entries
        .filter((entry) => entry.role !== "assistant")
        .map((entry) => (entry.role === "toolResult"
          ? entry.text.split("\n").filter((line) => !line.includes("FILLER")).join("\n")
          : entry.text))
        .join("\n");
      const ids = input.trace.entries.map((entry) => entry.entryId);
      return {
        shapedText,
        sourceSpan: { firstEntryId: ids[0] ?? "u1", lastEntryId: ids.at(-2) ?? "t1" },
        retainedTailStartId: ids.at(-1) ?? "u2",
        tokensBefore: 12_000,
      };
    },
  };
}

function liveNative(): W2NativeCompactor {
  return {
    async compact(input) {
      const visibleText = `pi-native\n${input.shapedText}`;
      return {
        visibleText,
        tokensAfter: visibleText.split(/\s+/u).filter(Boolean).length,
        outputHash: sha256(visibleText),
      };
    },
  };
}

function directiveStore(): DirectiveRecordStore {
  const rows: Array<DirectiveRecord & { cursor: RuntimeCursor }> = [];
  return {
    async put(record) {
      const index = rows.findIndex((row) => row.directiveId === record.directiveId);
      if (index >= 0) rows[index] = record;
      else rows.push(record);
    },
    async list(scope) {
      return rows.filter((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      ));
    },
  };
}

function continuityStore(): ContinuityStore {
  const rows: ContinuityRevision[] = [];
  return {
    async put(revision) { rows.push(revision); },
    async head(scope) {
      return [...rows].reverse().find((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
  };
}

async function livePcr(cursor: RuntimeCursor): Promise<W2PcrCompactor> {
  const directives = createDirectiveService({ cursor, store: directiveStore() });
  const text = "do not deploy production; 改为 version 7；以最新值为准";
  const bytes = Buffer.from(text, "utf8");
  const turn = {
    userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    cursor,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"e".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t43",
    sourceClass: "authenticated-user" as const,
    capturedAt: 43,
  };
  const clauses = createClauseSegmenter({ cursor }).segment({ text, cursor });
  for (const candidate of createDirectiveExtractor({ cursor }).extract(turn, clauses)) {
    await directives.apply(candidate);
  }
  const continuity = createContinuityService({ cursor, store: continuityStore() });
  await continuity.apply({ type: "open-front", cursor, title: "fix boom" });
  const claim: CompactionClaim = {
    claimId: "cl_t43_version",
    key: "version",
    polarity: "is",
    status: "active",
    value: "7",
  };
  const pointer: CompactionPointer = {
    ref: blobId(`blob_${"e".repeat(64)}`),
    kind: "evidence",
  };
  const service = createCompactionService({
    cursor,
    assembler: createCompactionSnapshotAssembler({
      cursor,
      transaction: { async run(work) { return work(); } },
      directives,
      continuity,
      claims: { async list() { return [claim]; } },
      evidence: { async pointers() { return [pointer]; } },
    }),
    renderer: createCheckpointRenderer({ cursor }),
    verifier: createCheckpointVerifier({ cursor, pointers: { async verify() {} } }),
  });
  return {
    async compact(input) {
      const decision = await service.prepareCompaction({
        operationId: `op_t43_${input.seed}_${input.materializer}`,
        cursor: input.cursor,
        reason: "threshold",
        now: 43,
        tokensBefore: input.tokensBefore,
        firstKeptEntryId: input.retainedTailStartId,
        signal: input.signal,
      });
      if (decision.kind !== "pcr") throw new Error(`expected pcr decision, got ${decision.kind}`);
      const visibleText = input.materializer === "pcr"
        ? `${decision.result.summary}\n[materialized]`
        : decision.result.summary;
      return {
        visibleText,
        tokensAfter: decision.result.estimatedTokensAfter,
        outputHash: decision.result.details.outputHash,
      };
    },
  };
}

describe("W2 paired live arms", () => {
  it("compacts the same W1-shaped trace on B0/B1/B2 with real PCR checkpoints", async () => {
    const root = dataRoot();
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-t43-live",
      leafId: "leaf-t43-live",
      lineageEntryIds: ["root", "leaf-t43-live"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const record: W1ArmCase = {
      caseId: "tool-noise-05",
      clusterId: "tool-noise",
      corpusId: "pcr-bench",
      trace: {
        workspaceId: cursor.workspaceId,
        sessionId: cursor.sessionId,
        entries: [
          { entryId: "u1", role: "user", text: "fix the boom", workspaceId: cursor.workspaceId, sessionId: cursor.sessionId },
          { entryId: "t1", role: "toolResult", text: RAW_TOOL, workspaceId: cursor.workspaceId, sessionId: cursor.sessionId },
          { entryId: "u2", role: "user", text: "keep going", workspaceId: cursor.workspaceId, sessionId: cursor.sessionId },
        ],
      },
      oracle: { items: [{ id: "error-1", key: "error", expected: "error: boom", sourceRefs: ["t1"] }] },
    };
    const runner = createW2ArmRunner({
      corpusId: "pcr-bench",
      manifest: {
        benchmarkMajor: 1,
        trainHash: "1".repeat(64),
        devHash: "2".repeat(64),
        lockedTestHash: "4".repeat(64),
        clusters: { "tool-noise": ["tool-noise-05"] },
      },
      cursor,
      cases: { async get(caseId) { return caseId === record.caseId ? record : null; } },
      shaper: liveShaper(),
      native: liveNative(),
      pcr: await livePcr(cursor),
    });
    const b0 = await runner.run(record.caseId, "B0", 7);
    const b1 = await runner.run(record.caseId, "B1", 7);
    const b2 = await runner.run(record.caseId, "B2", 7);
    expect(b0.shapedTraceHash).toBe(b1.shapedTraceHash);
    expect(b1.shapedTraceHash).toBe(b2.shapedTraceHash);
    expect(b0.sourceSpan).toEqual(b1.sourceSpan);
    expect(b0.retainedTailStartId).toBe(b1.retainedTailStartId);
    expect(b0.ingress).toBe("w1");
    expect(b1.ingress).toBe("w1");
    expect(b2.ingress).toBe("w1");
    expect(b0.compactor).toBe("pi-native");
    expect(b1.compactor).toBe("pcr-deterministic-checkpoint");
    expect(b2.compactor).toBe("pcr-materialized-checkpoint");
    expect(b0.visibleText).toContain("pi-native");
    expect(b0.visibleText).not.toContain("FILLER");
    expect(b1.visibleText).toContain("checkpoint v2");
    expect(b1.visibleText).not.toContain("[materialized]");
    expect(b2.visibleText).toContain("[materialized]");
    expect(b1.outputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(b2.outputHash).toBe(b1.outputHash);
  });
});
