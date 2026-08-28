import type { SemanticProposal } from "../semantic/proposal.js";

export interface RepairableState {
  evidence: readonly { id: string; text?: string }[];
}

export interface RepairGap {
  code: string;
}

export function applyDeterministicRepairs(
  proposal: SemanticProposal,
  gaps: readonly RepairGap[],
  state: RepairableState,
): { proposal: SemanticProposal; repaired: boolean } {
  const codes = new Set(gaps.map((gap) => gap.code));
  let repaired = false;
  let narrative = proposal.narrative;
  if (codes.has("NEW_CONCRETE_ENTITY")) {
    narrative = narrative.filter((item) => {
      const evidenced = state.evidence.some((entry) => entry.text && item.text.includes(entry.text));
      return evidenced || !/(?:src|lib|app|packages)\/[\w./-]/.test(item.text);
    });
    repaired = true;
  }
  if (codes.has("SUPPORT_MISSING")) {
    const known = new Set(state.evidence.map((item) => item.id));
    narrative = narrative.filter((item) => item.sourceIds.every((id) => known.has(id)));
    repaired = true;
  }
  return {
    proposal: {
      taskFrontUpdates: proposal.taskFrontUpdates,
      claimSelections: proposal.claimSelections,
      narrative,
    },
    repaired,
  };
}
