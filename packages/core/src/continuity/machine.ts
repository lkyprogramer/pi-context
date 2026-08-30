import type { RuntimeCursor } from "@pcr/contracts";

import { emptyContinuityRevision, reduceContinuityRevision, snapshotContinuityCursor } from "./reduce.js";
import {
  ContinuityError,
  type ContinuityEvent,
  type ContinuityRevision,
  type ContinuityService,
  type ContinuityStore,
  type CreateContinuityMachineInput,
} from "./types.js";

function failMissing(dependency: string): never {
  throw new ContinuityError("PCR_CONTINUITY_DEPENDENCY_MISSING", { dependency });
}

export function createContinuityMachine(input: CreateContinuityMachineInput): ContinuityService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.store || typeof input.store.put !== "function" || typeof input.store.head !== "function") {
    failMissing("store");
  }
  const bound = snapshotContinuityCursor(input.cursor, "input.cursor");
  const store = input.store;

  async function loadHead(): Promise<ContinuityRevision> {
    return (await store.head(bound)) ?? emptyContinuityRevision(bound);
  }

  return {
    async apply(event: ContinuityEvent): Promise<ContinuityRevision> {
      if (!event || typeof event !== "object") {
        throw new ContinuityError("PCR_CONTINUITY_INPUT_INVALID", { field: "event" });
      }
      if (event.signal !== undefined && !(event.signal instanceof AbortSignal)) {
        throw new ContinuityError("PCR_CONTINUITY_INPUT_INVALID", { field: "event.signal" });
      }
      event.signal?.throwIfAborted();
      const cursor = snapshotContinuityCursor(event.cursor, "event.cursor");
      if (
        cursor.workspaceId !== bound.workspaceId
        || cursor.sessionId !== bound.sessionId
        || cursor.leafId !== bound.leafId
        || cursor.lineageHash !== bound.lineageHash
        || cursor.modelKey !== bound.modelKey
      ) {
        throw new ContinuityError("PCR_CONTINUITY_SCOPE_MISMATCH");
      }
      event.signal?.throwIfAborted();
      const previous = await loadHead();
      event.signal?.throwIfAborted();
      const next = reduceContinuityRevision(previous, event);
      if (next.revisionId === previous.revisionId) return previous;
      event.signal?.throwIfAborted();
      await store.put(next);
      return next;
    },
    async current(cursorInput: RuntimeCursor): Promise<ContinuityRevision> {
      const cursor = snapshotContinuityCursor(cursorInput, "cursor");
      if (
        cursor.workspaceId !== bound.workspaceId
        || cursor.sessionId !== bound.sessionId
        || cursor.leafId !== bound.leafId
        || cursor.lineageHash !== bound.lineageHash
        || cursor.modelKey !== bound.modelKey
      ) {
        throw new ContinuityError("PCR_CONTINUITY_SCOPE_MISMATCH");
      }
      return loadHead();
    },
  };
}
