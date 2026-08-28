import type { MaterializationOmission, MaterializedSection, MaterializedSectionKind } from "../../../contracts/src/index.js";

export const REDUCTION_LADDER: MaterializedSectionKind[] = [
  "retrieval-page",
  "directory",
  "continuity-delta",
  "historical-tail",
];

export const PINNED_SECTIONS = new Set<MaterializedSectionKind>([
  "hard-directives",
  "active-turn",
  "runtime-preamble",
  "stable-continuity",
]);

export function reduceSectionsToBudget(
  sections: MaterializedSection[],
  budget: number,
  ladder: readonly MaterializedSectionKind[] = REDUCTION_LADDER,
): { sections: MaterializedSection[]; omissions: MaterializationOmission[] } {
  let selected = [...sections];
  const omissions: MaterializationOmission[] = [];
  const total = () => selected.reduce((sum, item) => sum + item.estimatedTokens, 0);
  for (const kind of ladder) {
    if (total() <= budget) break;
    const next = selected.filter((item) => item.kind !== kind);
    if (next.length === selected.length) continue;
    const dropped = selected.filter((item) => item.kind === kind);
    selected = next;
    omissions.push({ kind, reason: "budget-ladder", count: dropped.length });
  }
  return { sections: selected, omissions };
}
