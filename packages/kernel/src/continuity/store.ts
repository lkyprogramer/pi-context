import { domainHash } from "../../../contracts/src/index.js";
import type { ContinuityEvent, ContinuityRevision } from "../../../contracts/src/index.js";
import type { StoredContinuityRevision } from "../../../storage/src/protocol.js";
import { reduceContinuityRevision } from "./reducer.js";

export class ContinuityStore {
  private readonly revisions: StoredContinuityRevision[] = [];

  append(previous: ContinuityRevision, event: ContinuityEvent): ContinuityRevision {
    const next = reduceContinuityRevision(previous, event);
    this.revisions.push({
      revisionId: next.revisionId,
      parentRevisionId: next.parentRevisionId,
      payload: next,
      contentHash: domainHash("continuity-revision", next.revisionId),
    });
    return next;
  }

  list(): StoredContinuityRevision[] {
    return [...this.revisions];
  }

  head(): ContinuityRevision | undefined {
    const last = this.revisions.at(-1);
    return last?.payload as ContinuityRevision | undefined;
  }
}
