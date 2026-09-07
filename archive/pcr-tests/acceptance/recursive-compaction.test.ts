import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
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
  type DirectiveRecordStore,
} from "@pcr/runtime";

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

describe("recursive compaction boundedness", () => {
  it("keeps three compaction cycles under the injected model budget", async () => {
    const bound = createRuntimeCursor({
      workspacePath: WORK,
      sessionId: "session-accept-t33",
      leafId: "leaf-accept-t33",
      lineageEntryIds: ["root", "leaf-accept-t33"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const rows: Array<DirectiveRecord & { cursor: RuntimeCursor }> = [];
    const store: DirectiveRecordStore = {
      async put(record) { rows.push(record); },
      async list(scope) {
        return rows.filter((row) => row.cursor.sessionId === scope.sessionId);
      },
    };
    const revisions: ContinuityRevision[] = [];
    const continuityStore: ContinuityStore = {
      async put(revision) { revisions.push(revision); },
      async head() { return revisions.at(-1) ?? null; },
    };
    const directives = createDirectiveService({ cursor: bound, store });
    const text = "keep the parser on version 7; 以最新值为准";
    const bytes = Buffer.from(text, "utf8");
    const clauses = createClauseSegmenter({ cursor: bound }).segment({ text, cursor: bound });
    for (const candidate of createDirectiveExtractor({ cursor: bound }).extract({
      userTurnId: `user_turn_${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`,
      cursor: bound,
      rawTextHash: createHash("sha256").update(bytes).digest("hex"),
      rawBlobId: blobId(`blob_${"f".repeat(64)}`),
      utf8Bytes: bytes.byteLength,
      hostMessageId: "host-accept-t33",
      sourceClass: "authenticated-user",
      capturedAt: 33,
    }, clauses)) {
      await directives.apply(candidate);
    }
    const continuity = createContinuityService({ cursor: bound, store: continuityStore });
    await continuity.apply({ type: "open-front", cursor: bound, title: "long session" });
    const claim: CompactionClaim = {
      claimId: "cl_accept_t33",
      key: "version",
      polarity: "is",
      status: "active",
      value: "7",
    };
    const pointer: CompactionPointer = {
      ref: blobId(`blob_${"e".repeat(64)}`),
      kind: "evidence",
    };
    const compaction = createCompactionService({
      cursor: bound,
      assembler: createCompactionSnapshotAssembler({
        cursor: bound,
        transaction: { async run(work) { return work(); } },
        directives,
        continuity,
        claims: { async list() { return [claim]; } },
        evidence: { async pointers() { return [pointer]; } },
      }),
      renderer: createCheckpointRenderer({ cursor: bound }),
      verifier: createCheckpointVerifier({
        cursor: bound,
        pointers: { async verify() {} },
      }),
    });
    const report = await createRetentionController({
      cursor: bound,
      compaction,
      budgetTokens: 200000,
      inboundTokensPerCycle: 4000,
    }).run({
      seed: {
        operationId: "op_accept_t33",
        cursor: bound,
        reason: "threshold",
        now: 33,
        tokensBefore: 50000,
        firstKeptEntryId: "entry_tail",
      },
      cycles: 3,
    });
    expect(report).toMatchObject({ cycles: 3, passed: true });
    expect(report.maxActiveTokens).toBeLessThanOrEqual(200000);
    expect(report.growthSlope).toBeLessThanOrEqual(0);
  });
});
