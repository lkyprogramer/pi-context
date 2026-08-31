import type { DirectiveRecord, RuntimeCursor } from "@pcr/contracts";

export interface MergeSnapshot {
  cursor: RuntimeCursor;
  directives: readonly DirectiveRecord[];
  claims: ReadonlyArray<{ claimId: string; key: string; status: string; value: unknown }>;
  taskFronts: { active: unknown[]; parked: unknown[]; completed: unknown[]; superseded: unknown[] };
  sourceSpan: { first: string; last: string };
}

export function mergeCompactionStates(history: readonly MergeSnapshot[]): MergeSnapshot {
  if (!Array.isArray(history) || history.length === 0) {
    throw Object.assign(new Error("PCR_COMPACTION_MERGE_INPUT_INVALID"), { code: "PCR_COMPACTION_MERGE_INPUT_INVALID" });
  }
  const latest = history.at(-1)!;
  const directives = new Map<string, DirectiveRecord>();
  const claims = new Map<string, MergeSnapshot["claims"][number]>();
  for (const snapshot of history) {
    if (
      snapshot.cursor.workspaceId !== latest.cursor.workspaceId
      || snapshot.cursor.sessionId !== latest.cursor.sessionId
    ) {
      throw Object.assign(new Error("PCR_COMPACTION_MERGE_SCOPE_MISMATCH"), { code: "PCR_COMPACTION_MERGE_SCOPE_MISMATCH" });
    }
    for (const directive of snapshot.directives) {
      if (directive.status === "superseded") {
        directives.delete(directive.directiveId);
        if (directive.key) {
          for (const [id, current] of directives) {
            if (current.key === directive.key) directives.delete(id);
          }
        }
      }
      if (directive.status === "active") directives.set(directive.key ? `key:${directive.key}` : directive.directiveId, directive);
    }
    for (const claim of snapshot.claims) {
      if (claim.status === "active") claims.set(claim.key, claim);
    }
  }
  return {
    cursor: latest.cursor,
    directives: [...directives.values()],
    claims: [...claims.values()],
    taskFronts: latest.taskFronts,
    sourceSpan: {
      first: history[0]!.sourceSpan.first,
      last: latest.sourceSpan.last,
    },
  };
}
