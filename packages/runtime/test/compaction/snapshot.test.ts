import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createCompactionSnapshotAssembler,
  type CompactionRequest,
  type CreateCompactionSnapshotAssemblerInput,
} from "../../src/compaction/snapshot.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-runtime-snapshot",
    sessionId: "session-snapshot",
    leafId: "leaf-snapshot",
    lineageEntryIds: ["root", "leaf-snapshot"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function ports(bound = cursor()): CreateCompactionSnapshotAssemblerInput {
  return {
    cursor: bound,
    transaction: { async run(work) { return work(); } },
    directives: { async active() { return []; } },
    continuity: {
      async current() {
        return {
          revisionId: "cr_test",
          parentRevisionId: null,
          contentHash: "c".repeat(64),
          cursor: bound,
          taskFronts: { active: [], parked: [], completed: [], superseded: [] },
          nextSafeActions: [],
        };
      },
    },
    claims: { async list() { return []; } },
    evidence: { async pointers() { return []; } },
  };
}

function request(bound = cursor(), extras: Partial<CompactionRequest> = {}): CompactionRequest {
  return { operationId: "op_snapshot", cursor: bound, reason: "threshold", now: 1, ...extras };
}

describe("compaction snapshot assembler", () => {
  it("reads every source inside one transaction and hashes the records", async () => {
    const bound = cursor();
    const order: string[] = [];
    const assembler = createCompactionSnapshotAssembler({
      ...ports(bound),
      transaction: {
        async run(work) {
          order.push("transaction");
          return work();
        },
      },
      directives: {
        async active() {
          order.push("directives");
          return [];
        },
      },
      continuity: {
        async current() {
          order.push("continuity");
          return ports(bound).continuity.current(bound);
        },
      },
      claims: {
        async list() {
          order.push("claims");
          return [];
        },
      },
      evidence: {
        async pointers() {
          order.push("evidence");
          return [];
        },
      },
    });
    const snapshot = await assembler.assemble(request(bound));
    expect(order).toEqual(["transaction", "directives", "continuity", "claims", "evidence"]);
    expect(snapshot.claims).toEqual([]);
    expect(snapshot.pointers).toEqual([]);
    expect(snapshot.heads.contextHead).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.heads.contextHead).not.toBe("ctx_runtime");
  });

  it("fails construction when a production port is missing", () => {
    const bound = cursor();
    expect(() => createCompactionSnapshotAssembler({ ...ports(bound), claims: undefined as never })).toThrowError(
      expect.objectContaining({ code: "PCR_COMPACTION_SNAPSHOT_DEPENDENCY_MISSING" }),
    );
  });
});
