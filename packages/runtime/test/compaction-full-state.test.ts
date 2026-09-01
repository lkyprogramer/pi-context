import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { buildFullCheckpointState } from "../src/compaction/full-state.js";
import { createCompactionSnapshotAssembler } from "../src/compaction/snapshot.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-full-state",
    sessionId: "session-full-state",
    leafId: "leaf-full-state",
    lineageEntryIds: ["root", "leaf-full-state"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function directive(id: string, status: "active" | "superseded" = "active") {
  return {
    directiveId: id,
    userTurnId: `turn-${id}`,
    exactQuote: `${id} quote`,
    quoteHash: "a".repeat(64),
    utf8ByteRange: { start: 0, end: 1 },
    utf16Range: { start: 0, end: 1 },
    codePointRange: { start: 0, end: 1 },
    kind: "constraint" as const,
    polarity: "must" as const,
    status,
  };
}

describe("store-built full checkpoint state", () => {
  it("keeps parked and superseded fronts and retains superseded directives", () => {
    const bound = cursor();
    const empty = buildFullCheckpointState(bound, {
      directives: [],
      claims: [],
      taskFronts: { active: [], parked: [], completed: [], superseded: [] },
      errors: [],
      validation: [],
      nextSafeActions: [],
      sideEffects: [],
    });
    expect(empty.taskFronts.active).toEqual([]);
    const populated = buildFullCheckpointState(bound, {
      directives: [directive("d1"), directive("d0", "superseded")],
      claims: [{ key: "version", status: "active", value: "7" }, { key: "version", status: "superseded", value: "6" }],
      taskFronts: {
        active: [{ id: "front-active", title: "active", status: "active", goalClaimId: "c1", evidenceIds: [] }],
        parked: [{ id: "front-parked", title: "parked", status: "parked", goalClaimId: "c2", evidenceIds: [] }],
        completed: [{ id: "front-done", title: "done", status: "completed", goalClaimId: "c3", evidenceIds: [] }],
        superseded: [{ id: "front-old", title: "old", status: "superseded", goalClaimId: "c4", evidenceIds: [] }],
      },
      errors: ["tool bash failed"],
      validation: [{ id: "v1", status: "pending" }],
      nextSafeActions: [{ text: "rerun tests" }],
      sideEffects: ["gh:pr-opened"],
    });
    expect(populated.directives.map((item) => item.directiveId)).toEqual(["d1", "d0"]);
    expect(populated.claims).toEqual([
      { key: "version", status: "active", value: "7" },
      { key: "version", status: "superseded", value: "6" },
    ]);
    expect(populated.taskFronts.parked).toEqual([{ id: "front-parked", title: "parked", status: "parked", goalClaimId: "c2", evidenceIds: [] }]);
    expect(populated.taskFronts.superseded).toEqual([{ id: "front-old", title: "old", status: "superseded", goalClaimId: "c4", evidenceIds: [] }]);
    expect(populated.errors).toEqual(["tool bash failed"]);
    expect(populated.sideEffects).toEqual(["gh:pr-opened"]);
    expect(populated.validation).toEqual([{ id: "v1", status: "pending" }]);
  });

  it("assembles errors, validation, and side effects from store continuity", async () => {
    const bound = cursor();
    const assembler = createCompactionSnapshotAssembler({
      cursor: bound,
      transaction: { async run(work) { return work(); } },
      directives: { async active() { return [directive("d1")]; } },
      continuity: {
        async current() {
          return {
            revisionId: "cr_full",
            parentRevisionId: null,
            contentHash: "c".repeat(64),
            cursor: bound,
            taskFronts: {
              active: [{ id: "t-active", title: "ship", status: "active", goalClaimId: "c1", evidenceIds: [] }],
              parked: [{ id: "t-parked", title: "later", status: "parked", goalClaimId: "c2", evidenceIds: [] }],
              completed: [],
              superseded: [],
            },
            nextSafeActions: [{ text: "open the PR", requires: [] }],
            unresolvedErrors: [{ id: "e1", stage: "observed", message: "typecheck failed" }],
            externalSideEffects: [{ id: "s1", kind: "git", status: "running-unverified" }],
            validationState: [{ id: "v1", status: "pending" }],
          } as never;
        },
      },
      claims: { async list() { return [{ claimId: "c1", key: "version", polarity: "is", status: "active", value: "7" }]; } },
      evidence: { async pointers() { return [{ ref: `blob_${"a".repeat(64)}`, kind: "evidence" }]; } },
    });
    const snapshot = await assembler.assemble({
      operationId: "op-full",
      cursor: bound,
      reason: "manual",
      now: 1,
    });
    expect(snapshot.errors).toEqual(["typecheck failed"]);
    expect(snapshot.sideEffects.join(":")).toContain("git");
    expect(snapshot.validation).toEqual([{ id: "v1", status: "pending" }]);
    expect(snapshot.taskFronts.parked).toHaveLength(1);
    expect(snapshot.nextSafeActions).toEqual([{ text: "open the PR" }]);
    expect(snapshot.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
