import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import { emptyContinuityRevision, reduceContinuityRevision } from "../../src/continuity/reduce.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-core-continuity",
    sessionId: "session-continuity",
    leafId: "leaf-continuity",
    lineageEntryIds: ["root", "leaf-continuity"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("continuity reduction", () => {
  it("parks the previous front on a goal change and keeps it out of active", () => {
    const bound = cursor();
    const opened = reduceContinuityRevision(emptyContinuityRevision(bound), {
      type: "open-front",
      cursor: bound,
      title: "deploy service",
    });
    const changed = reduceContinuityRevision(opened, {
      type: "user-goal-change",
      cursor: bound,
      newGoal: "fix parser",
    });
    expect(changed.taskFronts.active.map((front) => front.title)).toEqual(["fix parser"]);
    expect(changed.taskFronts.parked.map((front) => front.title)).toEqual(["deploy service"]);
    expect(changed.parentRevisionId).toBe(opened.revisionId);
    expect(changed.revisionId).not.toBe(opened.revisionId);
  });

  it("fails closed instead of no-op on an illegal complete", () => {
    const bound = cursor();
    expect(() => reduceContinuityRevision(emptyContinuityRevision(bound), {
      type: "complete-front",
      cursor: bound,
      frontId: "tf_missing",
      evidenceId: `ev_${"c".repeat(64)}`,
    })).toThrowError(/PCR_CONTINUITY_TRANSITION_INVALID/);
  });
});
