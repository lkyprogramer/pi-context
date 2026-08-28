import { domainHash } from "../../../contracts/src/index.js";

export function computeLineageHash(leafId: string, parentLineage = ""): string {
  return domainHash("branch-lineage", { leafId, parentLineage });
}

export function switchBranchScope(input: { currentScope: string; currentLineage: string; newLeafId: string }): {
  previousBranchScope: string;
  branchScope: string;
  lineageHash: string;
} {
  return {
    previousBranchScope: input.currentScope,
    branchScope: `branch:${input.newLeafId}`,
    lineageHash: computeLineageHash(input.newLeafId, input.currentLineage),
  };
}
