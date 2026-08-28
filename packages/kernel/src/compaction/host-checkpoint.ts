import { domainHash, type HostCheckpoint, type HostCheckpointDetails } from "../../../contracts/src/index.js";
import { estimateTextTokens } from "../budget/token-counter.js";

export function sortByKeyThenId<T extends { key?: string; id?: string; claimId?: string; directiveId?: string }>(
  items: readonly T[],
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => {
    const keyCmp = keyOf(left).localeCompare(keyOf(right));
    return keyCmp !== 0 ? keyCmp : idOf(left).localeCompare(idOf(right));
  });
}

export function checkpointTokenPrice(text: string): number {
  return estimateTextTokens(text);
}

export function checkpointManifest(checkpoint: HostCheckpoint, outputHash: string): HostCheckpointDetails {
  return {
    schemaVersion: 1,
    directiveHead: checkpoint.heads.directiveHead,
    claimHead: checkpoint.heads.claimHead,
    continuityHead: checkpoint.heads.continuityHead,
    catalogHead: checkpoint.heads.catalogHead ?? "cah_none",
    outputHash,
    reducerRevisions: [],
  };
}

export function hashCheckpointBody(body: string): string {
  return domainHash("host-checkpoint", body);
}
