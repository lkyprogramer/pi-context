import { domainHash } from "../../../contracts/src/index.js";
import type { ContinuityRevision, TaskFront } from "../../../contracts/src/index.js";

export const CONTINUITY_FRONT_LIMIT = 64;

export function cloneContinuity(revision: ContinuityRevision): ContinuityRevision {
  return structuredClone(revision);
}

export function moveFront(fronts: ContinuityRevision["taskFronts"], front: TaskFront, to: keyof ContinuityRevision["taskFronts"]): void {
  for (const bucket of ["active", "parked", "completed", "superseded"] as const) {
    fronts[bucket] = fronts[bucket].filter((item) => item.id !== front.id);
  }
  fronts[to] = [...fronts[to], { ...front, status: to === "active" ? "active" : to === "parked" ? "parked" : to === "completed" ? "completed" : "superseded" }];
}

export function finalizeRevision(parentRevisionId: string, draft: ContinuityRevision): ContinuityRevision {
  const fingerprint = {
    parentRevisionId,
    active: draft.taskFronts.active.map((item) => item.id),
    parked: draft.taskFronts.parked.map((item) => item.id),
    completed: draft.taskFronts.completed.map((item) => item.id),
    superseded: draft.taskFronts.superseded.map((item) => item.id),
    sideEffects: draft.externalSideEffects.map((item) => `${item.id}:${item.status}`),
    errors: draft.unresolvedErrors.map((item) => item.id),
    actions: draft.nextSafeActions.map((item) => item.text),
  };
  return {
    ...draft,
    parentRevisionId,
    revisionId: `cr_${domainHash("continuity", fingerprint).slice(0, 16)}`,
  };
}

export function countFronts(revision: ContinuityRevision): number {
  const fronts = revision.taskFronts;
  return fronts.active.length + fronts.parked.length + fronts.completed.length + fronts.superseded.length;
}
