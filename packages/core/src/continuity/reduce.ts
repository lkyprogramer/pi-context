import { domainHash, type RuntimeCursor, type TaskFront, type TaskFrontStatus } from "@pcr/contracts";

import {
  CONTINUITY_FRONT_LIMIT,
  ContinuityError,
  type ContinuityEvent,
  type ContinuityRevision,
} from "./types.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EVENT_TYPES = new Set([
  "open-front",
  "user-goal-change",
  "park-front",
  "complete-front",
  "supersede-front",
  "reactivate-front",
]);

function failInput(field: string): never {
  throw new ContinuityError("PCR_CONTINUITY_INPUT_INVALID", { field });
}

function failTransition(reason: string): never {
  throw new ContinuityError("PCR_CONTINUITY_TRANSITION_INVALID", { reason });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function snapshotContinuityCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

export function emptyContinuityRevision(cursor: RuntimeCursor): ContinuityRevision {
  return finalizeRevision(null, {
    revisionId: "",
    parentRevisionId: null,
    contentHash: "",
    cursor,
    taskFronts: { active: [], parked: [], completed: [], superseded: [] },
    nextSafeActions: [],
  });
}

function cloneRevision(revision: ContinuityRevision): ContinuityRevision {
  return structuredClone(revision);
}

function countFronts(revision: ContinuityRevision): number {
  const fronts = revision.taskFronts;
  return fronts.active.length + fronts.parked.length + fronts.completed.length + fronts.superseded.length;
}

function findFront(revision: ContinuityRevision, frontId: string): TaskFront | undefined {
  for (const bucket of ["active", "parked", "completed", "superseded"] as const) {
    const found = revision.taskFronts[bucket].find((item) => item.id === frontId);
    if (found) return found;
  }
  return undefined;
}

function moveFront(draft: ContinuityRevision, front: TaskFront, to: TaskFrontStatus, evidenceId?: string): void {
  for (const bucket of ["active", "parked", "completed", "superseded"] as const) {
    draft.taskFronts[bucket] = draft.taskFronts[bucket].filter((item) => item.id !== front.id);
  }
  const evidenceIds = evidenceId && !front.evidenceIds.includes(evidenceId)
    ? [...front.evidenceIds, evidenceId]
    : [...front.evidenceIds];
  draft.taskFronts[to] = [...draft.taskFronts[to], { ...front, status: to, evidenceIds }];
}

function newFront(cursor: RuntimeCursor, title: string, parentRevisionId: string | null, evidenceId?: string): TaskFront {
  return {
    id: `tf_${domainHash("task-front", { cursor, parentRevisionId, title }).slice(0, 24)}`,
    title,
    status: "active",
    goalClaimId: `cl_${domainHash("continuity-goal", { cursor, title }).slice(0, 24)}`,
    evidenceIds: evidenceId ? [evidenceId] : [],
  };
}

function deriveActions(draft: ContinuityRevision): ContinuityRevision["nextSafeActions"] {
  return draft.taskFronts.active.map((front) => ({
    text: `continue ${front.title}`,
    requires: [...front.evidenceIds],
  }));
}

export function finalizeRevision(parentRevisionId: string | null, draft: ContinuityRevision): ContinuityRevision {
  const fingerprint = {
    active: draft.taskFronts.active.map((item) => item.id),
    completed: draft.taskFronts.completed.map((item) => item.id),
    parentRevisionId,
    parked: draft.taskFronts.parked.map((item) => item.id),
    superseded: draft.taskFronts.superseded.map((item) => item.id),
    titles: {
      active: draft.taskFronts.active.map((item) => item.title),
      completed: draft.taskFronts.completed.map((item) => item.title),
      parked: draft.taskFronts.parked.map((item) => item.title),
      superseded: draft.taskFronts.superseded.map((item) => item.title),
    },
  };
  const revisionId = `cr_${domainHash("continuity", fingerprint).slice(0, 24)}`;
  const next: ContinuityRevision = {
    ...draft,
    parentRevisionId,
    revisionId,
    nextSafeActions: deriveActions(draft),
    contentHash: "",
  };
  next.contentHash = domainHash("continuity-snapshot", next);
  return next;
}

function requireEvidence(value: unknown, field: string): string {
  requireNonEmpty(value, field);
  return value;
}

export function reduceContinuityRevision(previous: ContinuityRevision, event: ContinuityEvent): ContinuityRevision {
  if (!event || typeof event !== "object") failInput("event");
  if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) failInput("event.type");
  const cursor = snapshotContinuityCursor(event.cursor, "event.cursor");
  if (
    previous.cursor.workspaceId !== cursor.workspaceId
    || previous.cursor.sessionId !== cursor.sessionId
    || previous.cursor.leafId !== cursor.leafId
    || previous.cursor.lineageHash !== cursor.lineageHash
    || previous.cursor.modelKey !== cursor.modelKey
  ) {
    throw new ContinuityError("PCR_CONTINUITY_SCOPE_MISMATCH");
  }
  const draft = cloneRevision(previous);
  if (event.type === "open-front") {
    requireNonEmpty(event.title, "event.title");
    if (draft.taskFronts.active.some((front) => front.title === event.title)) {
      return previous;
    }
    if (countFronts(draft) >= CONTINUITY_FRONT_LIMIT) {
      throw new ContinuityError("PCR_CONTINUITY_OVERFLOW");
    }
    draft.taskFronts.active = [...draft.taskFronts.active, newFront(cursor, event.title, previous.revisionId, event.evidenceId)];
  } else if (event.type === "user-goal-change") {
    requireNonEmpty(event.newGoal, "event.newGoal");
    if (draft.taskFronts.active.length === 1 && draft.taskFronts.active[0]?.title === event.newGoal) {
      return previous;
    }
    for (const front of [...draft.taskFronts.active]) moveFront(draft, front, "parked");
    if (countFronts(draft) >= CONTINUITY_FRONT_LIMIT) {
      throw new ContinuityError("PCR_CONTINUITY_OVERFLOW");
    }
    draft.taskFronts.active = [newFront(cursor, event.newGoal, previous.revisionId, event.evidenceId)];
  } else if (event.type === "park-front") {
    requireNonEmpty(event.frontId, "event.frontId");
    const front = findFront(draft, event.frontId);
    if (!front || front.status !== "active") failTransition("park-requires-active");
    moveFront(draft, front, "parked");
  } else if (event.type === "complete-front") {
    requireNonEmpty(event.frontId, "event.frontId");
    const evidenceId = requireEvidence(event.evidenceId, "event.evidenceId");
    const front = findFront(draft, event.frontId);
    if (!front || front.status !== "active") failTransition("complete-requires-active");
    moveFront(draft, front, "completed", evidenceId);
  } else if (event.type === "supersede-front") {
    requireNonEmpty(event.frontId, "event.frontId");
    requireNonEmpty(event.replacementTitle, "event.replacementTitle");
    const front = findFront(draft, event.frontId);
    if (!front || front.status !== "active") failTransition("supersede-requires-active");
    moveFront(draft, front, "superseded", event.evidenceId);
    if (countFronts(draft) >= CONTINUITY_FRONT_LIMIT) {
      throw new ContinuityError("PCR_CONTINUITY_OVERFLOW");
    }
    draft.taskFronts.active = [...draft.taskFronts.active, newFront(cursor, event.replacementTitle, previous.revisionId, event.evidenceId)];
  } else if (event.type === "reactivate-front") {
    requireNonEmpty(event.frontId, "event.frontId");
    const evidenceId = requireEvidence(event.evidenceId, "event.evidenceId");
    const front = findFront(draft, event.frontId);
    if (!front) failTransition("unknown-front");
    if (front.status === "parked") {
      moveFront(draft, front, "active", evidenceId);
    } else if (front.status === "completed") {
      if (event.sourceClass !== "authenticated-user") failTransition("reactivate-requires-authenticated-user");
      moveFront(draft, front, "active", evidenceId);
    } else {
      failTransition("reactivate-requires-parked-or-completed");
    }
  }
  return finalizeRevision(previous.revisionId, draft);
}
