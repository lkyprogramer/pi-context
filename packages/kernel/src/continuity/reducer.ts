import type { ContinuityEvent, ContinuityRevision, SafeAction, TaskFront } from "../../../contracts/src/index.js";
import { cloneContinuity, CONTINUITY_FRONT_LIMIT, countFronts, finalizeRevision, moveFront } from "./model.js";

export function reduceContinuityRevision(previous: ContinuityRevision, event: ContinuityEvent): ContinuityRevision {
  if (event.type === "overflow" || countFronts(previous) > CONTINUITY_FRONT_LIMIT) {
    throw Object.assign(new Error("PCR_CONTINUITY_OVERFLOW"), { code: "PCR_CONTINUITY_OVERFLOW" });
  }
  const draft = cloneContinuity(previous);
  applyTaskFrontTransition(draft, event);
  applyExternalSideEffectTransition(draft, event);
  applyValidationTransition(draft, event);
  applyErrorTransition(draft, event);
  draft.nextSafeActions = deriveSafeActions(draft);
  return finalizeRevision(previous.revisionId, draft);
}

export function applyTaskFrontTransition(draft: ContinuityRevision, event: ContinuityEvent): void {
  if (event.type === "user-goal-change") {
    const moving = [...draft.taskFronts.active];
    for (const front of moving) {
      moveFront(draft.taskFronts, front, "parked");
    }
    const next: TaskFront = {
      id: `tf_${event.newGoal.replace(/\s+/g, "-").slice(0, 12).padEnd(8, "a")}`,
      title: event.newGoal,
      status: "active",
      goalClaimId: moving[0]?.goalClaimId ?? "cl_aaaaaaaa",
      evidenceIds: event.evidenceId ? [event.evidenceId] : [],
    };
    draft.taskFronts.active.push(next);
    return;
  }
  if (event.type === "complete-front") {
    const front = findFront(draft, event.frontId);
    if (!front) return;
    moveFront(draft.taskFronts, { ...front, evidenceIds: [...front.evidenceIds, event.evidenceId] }, "completed");
    return;
  }
  if (event.type === "reactivate-front") {
    const front = findFront(draft, event.frontId);
    if (!front || front.status !== "completed") return;
    if (!event.evidenceId || event.sourceClass !== "authenticated-user") return;
    moveFront(draft.taskFronts, { ...front, evidenceIds: [...front.evidenceIds, event.evidenceId] }, "active");
  }
}

export function applyExternalSideEffectTransition(draft: ContinuityRevision, event: ContinuityEvent): void {
  if (event.type !== "side-effect-update") return;
  const current = draft.externalSideEffects.find((item) => item.id === event.id);
  if (event.status === "verified" && !event.toolEvidenceId) {
    throw Object.assign(new Error("PCR_SIDE_EFFECT_EVIDENCE_MISSING"), { code: "PCR_SIDE_EFFECT_EVIDENCE_MISSING" });
  }
  if (!current) {
    draft.externalSideEffects.push({ id: event.id, kind: "unknown", status: event.status, toolEvidenceId: event.toolEvidenceId });
    return;
  }
  current.status = event.status;
  if (event.toolEvidenceId) current.toolEvidenceId = event.toolEvidenceId;
}

export function applyValidationTransition(draft: ContinuityRevision, event: ContinuityEvent): void {
  if (event.type !== "complete-front") return;
  draft.validationState.push({ id: `val_${event.frontId}`, status: "passed", evidenceId: event.evidenceId });
}

export function applyErrorTransition(draft: ContinuityRevision, event: ContinuityEvent): void {
  if (event.type === "error-observed") {
    draft.unresolvedErrors.push(event.error);
    return;
  }
  if (event.type === "reword-target") {
    return;
  }
}

export function deriveSafeActions(draft: ContinuityRevision): SafeAction[] {
  const running = draft.externalSideEffects.filter((item) => item.status === "running-unverified").map((item) => item.id);
  return draft.taskFronts.active.map((front) => ({
    text: `continue ${front.title}`,
    requires: front.evidenceIds,
    forbiddenRepeat: running,
  }));
}

function findFront(draft: ContinuityRevision, id: string): TaskFront | undefined {
  for (const bucket of ["active", "parked", "completed", "superseded"] as const) {
    const found = draft.taskFronts[bucket].find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}
