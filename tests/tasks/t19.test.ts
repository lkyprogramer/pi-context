import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createContinuityService,
  type ContinuityRevision,
  type ContinuityStore,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t19",
    sessionId: "session-t19",
    leafId: "leaf-t19",
    lineageEntryIds: ["root", "leaf-t19"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function memoryStore(): ContinuityStore {
  const rows: ContinuityRevision[] = [];
  return {
    async put(revision) {
      const index = rows.findIndex((row) => (
        row.revisionId === revision.revisionId
        && row.cursor.workspaceId === revision.cursor.workspaceId
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

async function runT19Fixture() {
  const bound = cursor();
  const store = memoryStore();
  const service = createContinuityService({ cursor: bound, store });
  await service.apply({ type: "open-front", cursor: bound, title: "deploy service" });
  await service.apply({ type: "user-goal-change", cursor: bound, newGoal: "fix parser" });
  const afterGoal = await service.current(bound);
  const parser = afterGoal.taskFronts.active[0];
  await service.apply({
    type: "supersede-front",
    cursor: bound,
    frontId: parser!.id,
    replacementTitle: "fix lexer",
  });
  const afterSupersede = await service.current(bound);
  const lexer = afterSupersede.taskFronts.active[0];
  await service.apply({
    type: "complete-front",
    cursor: bound,
    frontId: lexer!.id,
    evidenceId: `ev_${"b".repeat(64)}`,
  });
  await service.apply({ type: "open-front", cursor: bound, title: "write docs" });
  const snapshot = await service.current(bound);
  expect(snapshot.taskFronts.active.map((front) => front.title)).toEqual(["write docs"]);
  expect(snapshot.taskFronts.parked.map((front) => front.title)).toEqual(["deploy service"]);
  expect(snapshot.taskFronts.completed.map((front) => front.title)).toEqual(["fix lexer"]);
  expect(snapshot.taskFronts.superseded.map((front) => front.title)).toEqual(["fix parser"]);
  expect(snapshot.taskFronts.active[0]?.status).toBe("active");
  expect(snapshot.taskFronts.parked[0]?.status).toBe("parked");
  expect(snapshot.taskFronts.completed[0]?.status).toBe("completed");
  expect(snapshot.taskFronts.superseded[0]?.status).toBe("superseded");
  const replayed = await service.current(bound);
  expect(replayed).toEqual(snapshot);
  return { ok: true as const, task: "T19" as const, snapshot };
}

describe("T19 Continuity and task-front state machine", () => {
  it("continuity_and_task_front_state_machine", async () => {
    await expect(runT19Fixture()).resolves.toMatchObject({ ok: true, task: "T19" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createContinuityService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CONTINUITY_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed events and illegal transitions", async () => {
    const bound = cursor();
    const service = createContinuityService({ cursor: bound, store: memoryStore() });
    await expect(service.apply({} as never)).rejects.toThrow(/PCR_CONTINUITY_INPUT_INVALID/);
    await expect(service.apply({
      type: "complete-front",
      cursor: bound,
      frontId: "tf_missing",
      evidenceId: `ev_${"c".repeat(64)}`,
    })).rejects.toThrow(/PCR_CONTINUITY_TRANSITION_INVALID/);
  });

  it("replays the same open-front without duplicating the active set", async () => {
    const bound = cursor();
    const service = createContinuityService({ cursor: bound, store: memoryStore() });
    const first = await service.apply({ type: "open-front", cursor: bound, title: "deploy service" });
    const second = await service.apply({ type: "open-front", cursor: bound, title: "deploy service" });
    expect(second).toEqual(first);
    expect((await service.current(bound)).taskFronts.active).toHaveLength(1);
  });

  it("rejects a cursor from another workspace/session/branch", async () => {
    const bound = cursor();
    const service = createContinuityService({ cursor: bound, store: memoryStore() });
    const other = { ...bound, sessionId: "other-session" };
    await expect(service.apply({ type: "open-front", cursor: other, title: "deploy service" })).rejects.toThrow(
      /PCR_CONTINUITY_SCOPE_MISMATCH/,
    );
    await expect(service.current(other)).rejects.toThrow(/PCR_CONTINUITY_SCOPE_MISMATCH/);
  });

  it("does not reactivate a completed front without authenticated evidence", async () => {
    const bound = cursor();
    const service = createContinuityService({ cursor: bound, store: memoryStore() });
    const opened = await service.apply({ type: "open-front", cursor: bound, title: "deploy service" });
    const frontId = opened.taskFronts.active[0]!.id;
    await service.apply({
      type: "complete-front",
      cursor: bound,
      frontId,
      evidenceId: `ev_${"d".repeat(64)}`,
    });
    await expect(service.apply({
      type: "reactivate-front",
      cursor: bound,
      frontId,
      evidenceId: `ev_${"e".repeat(64)}`,
      sourceClass: "untrusted-user",
    })).rejects.toThrow(/PCR_CONTINUITY_TRANSITION_INVALID/);
    expect((await service.current(bound)).taskFronts.completed.map((front) => front.id)).toEqual([frontId]);
  });

  it("stops at the abort boundary before reducing", async () => {
    const bound = cursor();
    const service = createContinuityService({ cursor: bound, store: memoryStore() });
    const controller = new AbortController();
    controller.abort();
    await expect(service.apply({
      type: "open-front",
      cursor: bound,
      title: "deploy service",
      signal: controller.signal,
    })).rejects.toThrow();
  });
});
