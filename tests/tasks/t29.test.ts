import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { blobId, domainHash, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import {
  createClauseSegmenter,
  createDirectiveExtractor,
  createRuntimeCursor,
  type ContinuityRevision,
  type ContinuityStore,
} from "@pcr/core";
import {
  createCompactionSnapshotAssembler,
  createContinuityService,
  createDirectiveService,
  type CompactionClaim,
  type CompactionPointer,
  type CompactionRequest,
  type CompactionSnapshot,
  type DirectiveRecordStore,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t29",
    sessionId: "session-t29",
    leafId: "leaf-t29",
    lineageEntryIds: ["root", "leaf-t29"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function turnFor(text: string, bound = cursor()) {
  const bytes = Buffer.from(text, "utf8");
  return {
    userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
    cursor: bound,
    rawTextHash: createHash("sha256").update(bytes).digest("hex"),
    rawBlobId: blobId(`blob_${"d".repeat(64)}`),
    utf8Bytes: bytes.byteLength,
    hostMessageId: "host-t29",
    sourceClass: "authenticated-user" as const,
    capturedAt: 29,
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
    async put(revision) {
      const index = rows.findIndex((row) => (
        row.revisionId === revision.revisionId
        && row.cursor.sessionId === revision.cursor.sessionId
      ));
      if (index >= 0) rows[index] = revision;
      else rows.push(revision);
    },
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

function request(bound = cursor(), extras: Partial<CompactionRequest> = {}): CompactionRequest {
  return {
    operationId: "op_t29",
    cursor: bound,
    reason: "manual",
    now: 29,
    ...extras,
  };
}

async function seed(bound = cursor()) {
  const directives = createDirectiveService({ cursor: bound, store: directiveStore() });
  const clauses = createClauseSegmenter({ cursor: bound }).segment({
    text: "do not deploy production; 改为 version 7；以最新值为准",
    cursor: bound,
  });
  const candidates = createDirectiveExtractor({ cursor: bound }).extract(
    turnFor("do not deploy production; 改为 version 7；以最新值为准", bound),
    clauses,
  );
  for (const candidate of candidates) await directives.apply(candidate);
  const continuity = createContinuityService({ cursor: bound, store: continuityStore() });
  await continuity.apply({ type: "open-front", cursor: bound, title: "fix parser" });
  const claim: CompactionClaim = {
    claimId: "cl_t29_version",
    key: "version",
    polarity: "is",
    status: "active",
    value: "7",
  };
  const pointer: CompactionPointer = {
    ref: blobId(`blob_${"e".repeat(64)}`),
    kind: "evidence",
  };
  const claims = {
    async list() { return [claim]; },
  };
  const evidence = {
    async pointers() { return [pointer]; },
  };
  const transaction = {
    async run<T>(work: () => Promise<T>) { return work(); },
  };
  const assembler = createCompactionSnapshotAssembler({
    cursor: bound,
    transaction,
    directives,
    continuity,
    claims,
    evidence,
  });
  return { bound, assembler, directives, continuity, claim, pointer };
}

async function runT29Fixture() {
  const { assembler, bound, claim, pointer } = await seed();
  const snapshot: CompactionSnapshot = await assembler.assemble(request(bound));
  expect(snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(snapshot.snapshotHash).toBe(domainHash("compaction-snapshot", {
    cursor: bound,
    assembledAt: 29,
    reason: "manual",
    directives: snapshot.directives,
    continuity: snapshot.continuity,
    claims: snapshot.claims,
    pointers: snapshot.pointers,
    heads: snapshot.heads,
  }));
  expect(snapshot.directives.some((item) => item.exactQuote.includes("do not deploy production"))).toBe(true);
  expect(snapshot.directives.some((item) => item.key === "version" && item.value === "7")).toBe(true);
  expect(snapshot.continuity.taskFronts.active.map((front) => front.title)).toEqual(["fix parser"]);
  expect(snapshot.claims).toEqual([claim]);
  expect(snapshot.pointers).toEqual([pointer]);
  expect(snapshot.heads.contextHead).not.toBe("ctx_runtime");
  expect(snapshot.heads.continuityHead).not.toBe("cth_runtime");
  expect(snapshot.heads.directiveHead).toMatch(/^[a-f0-9]{64}$/u);
  expect(snapshot.heads.claimHead).toMatch(/^[a-f0-9]{64}$/u);
  expect(snapshot.heads.catalogHead).toMatch(/^[a-f0-9]{64}$/u);
  const replayed = await assembler.assemble(request(bound));
  expect(replayed).toEqual(snapshot);
  return { ok: true as const, task: "T29" as const, snapshot };
}

describe("T29 Authoritative compaction snapshot assembler", () => {
  it("authoritative_compaction_snapshot_assembler", async () => {
    await expect(runT29Fixture()).resolves.toMatchObject({ ok: true, task: "T29" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createCompactionSnapshotAssembler({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_COMPACTION_SNAPSHOT_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed requests and empty operation ids", async () => {
    const { assembler, bound } = await seed();
    await expect(assembler.assemble({} as never)).rejects.toMatchObject({ code: "PCR_COMPACTION_SNAPSHOT_INPUT_INVALID" });
    await expect(assembler.assemble(request(bound, { operationId: "" }))).rejects.toMatchObject({
      code: "PCR_COMPACTION_SNAPSHOT_INPUT_INVALID",
    });
  });

  it("replays the same request to an equal snapshot", async () => {
    const { assembler, bound } = await seed();
    const first = await assembler.assemble(request(bound));
    const second = await assembler.assemble(request(bound));
    expect(second).toEqual(first);
  });

  it("rejects a cursor from another workspace", async () => {
    const { assembler } = await seed();
    const other = cursor();
    const foreign = createRuntimeCursor({
      workspacePath: "/tmp/pcr-t29-other",
      sessionId: other.sessionId,
      leafId: other.leafId,
      lineageEntryIds: ["root", "leaf-t29"],
      modelKey: other.modelKey,
    });
    await expect(assembler.assemble(request(foreign))).rejects.toMatchObject({
      code: "PCR_COMPACTION_SNAPSHOT_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before reading stores", async () => {
    const bound = cursor();
    let reads = 0;
    const assembler = createCompactionSnapshotAssembler({
      cursor: bound,
      transaction: {
        async run<T>(work: () => Promise<T>) {
          reads += 1;
          return work();
        },
      },
      directives: { async active() { reads += 1; return []; } },
      continuity: { async current() { reads += 1; return { revisionId: "x", parentRevisionId: null, contentHash: "y", cursor: bound, taskFronts: { active: [], parked: [], completed: [], superseded: [] }, nextSafeActions: [] }; } },
      claims: { async list() { reads += 1; return []; } },
      evidence: { async pointers() { reads += 1; return []; } },
    });
    const signal = AbortSignal.abort();
    await expect(assembler.assemble(request(bound, { signal }))).rejects.toThrow();
    expect(reads).toBe(0);
  });
});
