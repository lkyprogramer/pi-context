import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

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
  createRetentionController,
  type CompactionClaim,
  type CompactionPointer,
  type CompactionPrepareRequest,
  type CompactionService,
  type DirectiveRecordStore,
} from "@pcr/runtime";

const WORK = "/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-14eb40de3fb3/implementer/t33";

function cursor(leafId = "leaf-t33") {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t33",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function turnFor(text: string, bound = cursor()) {
  const bytes = Buffer.from(text, "utf8");
  return {
    userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    cursor: bound,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"f".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t33",
    sourceClass: "authenticated-user" as const,
    capturedAt: 33,
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

async function seedCompaction(bound = cursor()): Promise<{ bound: RuntimeCursor; compaction: CompactionService }> {
  const directives = createDirectiveService({ cursor: bound, store: directiveStore() });
  const text = "do not deploy production; 改为 version 7；以最新值为准";
  const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
  for (const candidate of createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses)) {
    await directives.apply(candidate);
  }
  const continuity = createContinuityService({ cursor: bound, store: continuityStore() });
  await continuity.apply({ type: "open-front", cursor: bound, title: "fix parser" });
  const claim: CompactionClaim = {
    claimId: "cl_t33_version",
    key: "version",
    polarity: "is",
    status: "active",
    value: "7",
  };
  const pointer: CompactionPointer = {
    ref: blobId(`blob_${"e".repeat(64)}`),
    kind: "evidence",
  };
  const assembler = createCompactionSnapshotAssembler({
    cursor: bound,
    transaction: { async run(work) { return work(); } },
    directives,
    continuity,
    claims: { async list() { return [claim]; } },
    evidence: { async pointers() { return [pointer]; } },
  });
  return {
    bound,
    compaction: createCompactionService({
      cursor: bound,
      assembler,
      renderer: createCheckpointRenderer({ cursor: bound }),
      verifier: createCheckpointVerifier({
        cursor: bound,
        pointers: { async verify() {} },
      }),
    }),
  };
}

function seedRequest(bound: RuntimeCursor): CompactionPrepareRequest {
  return {
    operationId: "op_t33",
    cursor: bound,
    reason: "threshold",
    now: 33,
    tokensBefore: 50000,
    firstKeptEntryId: "entry_tail",
  };
}

async function runT33Fixture() {
  const { bound, compaction } = await seedCompaction();
  const controller = createRetentionController({
    cursor: bound,
    compaction,
    budgetTokens: 200000,
    inboundTokensPerCycle: 4000,
  });
  const report = await controller.run({ seed: seedRequest(bound), cycles: 3 });
  expect(report.cycles).toBe(3);
  expect(report.passed).toBe(true);
  expect(report.maxActiveTokens).toBeLessThanOrEqual(200000);
  expect(report.growthSlope).toBeLessThanOrEqual(0);
  expect(report.maxActiveTokens).toBeGreaterThan(0);
  const replayed = await controller.run({ seed: seedRequest(bound), cycles: 3 });
  expect(replayed).toEqual(report);
  return { ok: true as const, task: "T33" as const, report };
}

describe("T33 Recursive compaction and long-session boundedness", () => {
  it("recursive_compaction_and_long_session_boundednes", async () => {
    await expect(runT33Fixture()).resolves.toMatchObject({ ok: true, task: "T33" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createRetentionController({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RETENTION_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed run input", async () => {
    const { bound, compaction } = await seedCompaction();
    const controller = createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: 200000,
      inboundTokensPerCycle: 4000,
    });
    await expect(controller.run({} as never)).rejects.toMatchObject({ code: "PCR_RETENTION_INPUT_INVALID" });
    await expect(controller.run({ seed: seedRequest(bound), cycles: 2 })).rejects.toMatchObject({
      code: "PCR_RETENTION_INPUT_INVALID",
    });
  });

  it("replays three-cycle boundedness for the same seed", async () => {
    const { bound, compaction } = await seedCompaction();
    const controller = createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: 200000,
      inboundTokensPerCycle: 4000,
    });
    const input = { seed: seedRequest(bound), cycles: 3 };
    const first = await controller.run(input);
    const second = await controller.run(input);
    expect(second).toEqual(first);
    expect(first.cycles).toBe(3);
    expect(first.passed).toBe(true);
  });

  it("rejects a cursor from another workspace", async () => {
    const { bound, compaction } = await seedCompaction();
    const controller = createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: 200000,
      inboundTokensPerCycle: 4000,
    });
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t33",
      leafId: "leaf-t33",
      lineageEntryIds: ["root", "leaf-t33"],
      modelKey: bound.modelKey,
    });
    await expect(controller.run({ seed: { ...seedRequest(bound), cursor: other }, cycles: 3 })).rejects.toMatchObject({
      code: "PCR_RETENTION_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before compacting", async () => {
    const bound = cursor();
    let prepared = 0;
    const controller = createRetentionController({
      cursor: bound,
      compaction: {
        async prepareCompaction() {
          prepared += 1;
          throw new Error("should not compact");
        },
      },
      budgetTokens: 200000,
      inboundTokensPerCycle: 4000,
    });
    await expect(controller.run({
      seed: { ...seedRequest(bound), signal: AbortSignal.abort() },
      cycles: 3,
    })).rejects.toThrow();
    expect(prepared).toBe(0);
  });

  it("fails boundedness when the PCR summary already exceeds the injected budget", async () => {
    const { bound, compaction } = await seedCompaction();
    const probe = createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: 200000,
      inboundTokensPerCycle: 0,
    });
    const baseline = await probe.run({ seed: seedRequest(bound), cycles: 3 });
    const tight = createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: Math.max(1, baseline.maxActiveTokens - 1),
      inboundTokensPerCycle: 4000,
    });
    const report = await tight.run({ seed: seedRequest(bound), cycles: 3 });
    expect(report.passed).toBe(false);
    expect(report.cycles).toBeGreaterThanOrEqual(1);
    expect(report.maxActiveTokens).toBeGreaterThan(tightBudget(baseline.maxActiveTokens));
  });
});

function tightBudget(maxActiveTokens: number): number {
  return Math.max(1, maxActiveTokens - 1);
}
