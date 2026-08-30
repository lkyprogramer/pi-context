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
  createCompactionSnapshotAssembler,
  createContinuityService,
  createDirectiveService,
  type CompactionClaim,
  type CompactionPointer,
  type DirectiveRecordStore,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t30",
    sessionId: "session-t30",
    leafId: "leaf-t30",
    lineageEntryIds: ["root", "leaf-t30"],
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
    hostMessageId: "host-t30",
    sourceClass: "authenticated-user" as const,
    capturedAt: 30,
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
      rows.push(revision);
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

async function seed(bound = cursor()) {
  const directives = createDirectiveService({ cursor: bound, store: directiveStore() });
  const text = "do not deploy production; 改为 version 7；以最新值为准";
  const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
  for (const candidate of createDirectiveExtractor({ cursor: bound }).extract(turnFor(text, bound), clauses)) {
    await directives.apply(candidate);
  }
  const continuity = createContinuityService({ cursor: bound, store: continuityStore() });
  await continuity.apply({ type: "open-front", cursor: bound, title: "fix parser" });
  const claim: CompactionClaim = {
    claimId: "cl_t30_version",
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
  const snapshot = await assembler.assemble({
    operationId: "op_t30",
    cursor: bound,
    reason: "manual",
    now: 30,
  });
  const renderer = createCheckpointRenderer({ cursor: bound });
  const verified: CompactionPointer[] = [];
  const verifier = createCheckpointVerifier({
    cursor: bound,
    pointers: {
      async verify(_cursor, items) {
        verified.push(...items);
      },
    },
  });
  return { bound, snapshot, renderer, verifier, verified, claim, pointer };
}

async function runT30Fixture() {
  const { snapshot, renderer, verifier, verified } = await seed();
  const first = await renderer.render(snapshot);
  const second = await renderer.render(snapshot);
  expect(second).toEqual(first);
  expect(first.version).toBe(2);
  expect(first.snapshotHash).toBe(snapshot.snapshotHash);
  expect(first.directives.some((item) => item.polarity === "must-not" && item.exactQuote.includes("do not deploy production"))).toBe(true);
  expect(first.directives.every((item) => item.polarity !== "must-not" || item.kind === "prohibition" || item.kind === "constraint")).toBe(true);
  expect(first.directives.some((item) => item.key === "version" && item.value === "7" && item.polarity === "must")).toBe(true);
  expect(first.claims).toEqual(snapshot.claims);
  expect(first.pointers).toEqual(snapshot.pointers);
  expect(first.heads).toEqual(snapshot.heads);
  const report = await verifier.verify(snapshot, first);
  expect(report.ok).toBe(true);
  expect(report.outputHash).toMatch(/^[a-f0-9]{64}$/u);
  const replayed = await verifier.verify(snapshot, second);
  expect(replayed.outputHash).toBe(report.outputHash);
  expect(verified.length).toBeGreaterThan(0);
  const rewritten = {
    ...first,
    directives: first.directives.map((item) => ({ ...item, polarity: "must-not" as const, status: "active" as const })),
  };
  const rejected = await verifier.verify(snapshot, rewritten);
  expect(rejected.ok).toBe(false);
  expect(rejected.issues.some((item) => item.code === "PCR_CHECKPOINT_DIRECTIVE_REWRITTEN")).toBe(true);
  return { ok: true as const, task: "T30" as const, report };
}

describe("T30 Deterministic checkpoint renderer and verifier", () => {
  it("deterministic_checkpoint_renderer_and_verifier", async () => {
    await expect(runT30Fixture()).resolves.toMatchObject({ ok: true, task: "T30" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createCheckpointVerifier({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CHECKPOINT_DEPENDENCY_MISSING" }),
    );
    expect(() => createCheckpointRenderer({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CHECKPOINT_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed snapshots and candidates", async () => {
    const { renderer, verifier, snapshot } = await seed();
    await expect(renderer.render({} as never)).rejects.toMatchObject({ code: "PCR_CHECKPOINT_INPUT_INVALID" });
    await expect(verifier.verify(snapshot, {} as never)).rejects.toMatchObject({ code: "PCR_CHECKPOINT_INPUT_INVALID" });
  });

  it("replays render and verify to equal output hashes", async () => {
    const { renderer, verifier, snapshot } = await seed();
    const a = await renderer.render(snapshot);
    const b = await renderer.render(snapshot);
    expect(b).toEqual(a);
    const first = await verifier.verify(snapshot, a);
    const second = await verifier.verify(snapshot, b);
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("rejects a snapshot from another workspace", async () => {
    const { renderer, snapshot } = await seed();
    const other = createRuntimeCursor({
      workspacePath: "/tmp/pcr-t30-other",
      sessionId: snapshot.cursor.sessionId,
      leafId: snapshot.cursor.leafId,
      lineageEntryIds: ["root", "leaf-t30"],
      modelKey: snapshot.cursor.modelKey,
    });
    await expect(createCheckpointRenderer({ cursor: other }).render(snapshot)).rejects.toMatchObject({
      code: "PCR_CHECKPOINT_SCOPE_MISMATCH",
    });
    void renderer;
  });

  it("stops at the abort boundary before pointer I/O", async () => {
    const bound = cursor();
    let reads = 0;
    const verifier = createCheckpointVerifier({
      cursor: bound,
      pointers: {
        async verify() {
          reads += 1;
        },
      },
    });
    const signal = AbortSignal.abort();
    await expect(verifier.verify({
      snapshotHash: "a".repeat(64),
      cursor: bound,
      assembledAt: 1,
      reason: "manual",
      directives: [],
      continuity: {
        revisionId: "cr_x",
        parentRevisionId: null,
        contentHash: "c".repeat(64),
        cursor: bound,
        taskFronts: { active: [], parked: [], completed: [], superseded: [] },
        nextSafeActions: [],
      },
      claims: [],
      pointers: [{ ref: "ev_x", kind: "evidence" }],
      heads: {
        contextHead: "a".repeat(64),
        directiveHead: "b".repeat(64),
        claimHead: "c".repeat(64),
        continuityHead: "d".repeat(64),
        catalogHead: "e".repeat(64),
      },
    }, {
      version: 2,
      snapshotHash: "a".repeat(64),
      directives: [],
      continuity: {},
      claims: [],
      pointers: [],
      heads: {},
    }, signal)).rejects.toThrow();
    expect(reads).toBe(0);
  });
});
