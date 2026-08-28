import type { SemanticProposal } from "../semantic/proposal.js";
import { deterministicFloor, type DeterministicFloor } from "./deterministic-floor.js";
import { applyDeterministicRepairs } from "./repairs.js";

export interface VerifierGap {
  code: string;
}

export interface VerifierReport {
  ok: boolean;
  gaps: VerifierGap[];
  repaired: boolean;
  usedFloor: boolean;
  floor: DeterministicFloor;
}

export interface StateClaim {
  claimId: string;
  role?: string;
  polarity?: string;
  validUntil?: number | null;
  authority?: "none" | "inform" | "propose" | "act";
  conflictsWith?: readonly string[];
  status?: string;
}

export interface StateEvidence {
  id: string;
  kind?: string;
  ok?: boolean;
  sourceClass?: string;
  text?: string;
}

export interface VerificationState {
  sourceHead: string;
  knownClaimIds: readonly string[];
  knownFrontIds: readonly string[];
  knownSourceIds: readonly string[];
  claims: readonly StateClaim[];
  evidence: readonly StateEvidence[];
  tokensBefore?: number;
  tokensAfter?: number;
  hardDirectives?: readonly { id: string; covered: boolean }[];
  now?: number;
}

const TERMINAL = new Set(["UNSUPPORTED_OUTCOME", "AUTHORITY_ESCALATION", "CONFLICT_DROPPED", "MUST_SHRINK"]);

export async function verifySemanticProposal(
  proposal: SemanticProposal,
  state: VerificationState,
): Promise<VerifierReport> {
  const gaps = collectGaps(proposal, state);
  const floor = deterministicFloor(state);
  if (gaps.length === 0) return { ok: true, gaps: [], repaired: false, usedFloor: false, floor };
  if (gaps.some((gap) => TERMINAL.has(gap.code))) {
    return { ok: false, gaps, repaired: false, usedFloor: true, floor };
  }
  const repaired = applyDeterministicRepairs(proposal, gaps, state);
  return recheckOrFloor(repaired.proposal, state, repaired.repaired);
}

export function collectGaps(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  return [
    ...checkSchemaAndIds(proposal, state),
    ...checkSupportClosure(proposal, state),
    ...checkPolarityAndTime(proposal, state),
    ...checkAuthority(proposal, state),
    ...checkOutcomeAttestation(proposal, state),
    ...checkDirectiveCoverage(proposal, state),
    ...checkMustShrink(state),
    ...checkNewConcreteEntities(proposal, state),
    ...checkConflictsRetained(proposal, state),
  ];
}

export function hasConcreteEntity(text: string, state: VerificationState): boolean {
  const evidenced = state.evidence.some((item) => item.text && text.includes(item.text));
  if (evidenced) return false;
  return /(?:^|[\s"'`])(?:\.\.?\/|\/)?(?:src|lib|app|packages)\/[\w./-]+/.test(text) || /\b\d{3,}\b/.test(text);
}

export { applyDeterministicRepairs, deterministicFloor };

function recheckOrFloor(proposal: SemanticProposal, state: VerificationState, repaired: boolean): VerifierReport {
  const gaps = collectGaps(proposal, state);
  const floor = deterministicFloor(state);
  if (gaps.length === 0) return { ok: true, gaps: [], repaired, usedFloor: false, floor };
  return { ok: false, gaps, repaired, usedFloor: true, floor };
}

function checkSchemaAndIds(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const gaps: VerifierGap[] = [];
  const claims = new Set(state.knownClaimIds);
  const fronts = new Set(state.knownFrontIds);
  const sources = new Set(state.knownSourceIds);
  for (const item of proposal.claimSelections) {
    if (!claims.has(item.claimId)) gaps.push({ code: "SCHEMA_OR_ID" });
  }
  for (const item of proposal.taskFrontUpdates) {
    if (!fronts.has(item.frontId) || item.sourceIds.some((id) => !sources.has(id))) gaps.push({ code: "SCHEMA_OR_ID" });
  }
  for (const item of proposal.narrative) {
    if (item.sourceIds.length === 0 || item.sourceIds.some((id) => !sources.has(id))) gaps.push({ code: "SCHEMA_OR_ID" });
  }
  return unique(gaps);
}

function checkSupportClosure(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const evidence = new Set(state.evidence.map((item) => item.id));
  for (const item of proposal.narrative) {
    if (item.sourceIds.some((id) => !evidence.has(id))) return [{ code: "SUPPORT_MISSING" }];
  }
  return [];
}

function checkPolarityAndTime(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const now = state.now ?? 0;
  for (const selection of proposal.claimSelections) {
    const claim = state.claims.find((item) => item.claimId === selection.claimId);
    if (!claim) continue;
    if (claim.validUntil != null && claim.validUntil <= now) return [{ code: "POLARITY_OR_TIME" }];
    if (claim.polarity === "must-not" && selection.role === "outcome") return [{ code: "POLARITY_OR_TIME" }];
  }
  return [];
}

function checkAuthority(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const rank = { none: 0, inform: 1, propose: 2, act: 3 };
  for (const selection of proposal.claimSelections) {
    if (selection.role !== "outcome") continue;
    const cited = proposal.narrative.filter((item) => item.epistemic === "supported").flatMap((item) => item.sourceIds);
    const evidence = state.evidence.filter((item) => cited.includes(item.id));
    if (evidence.some((item) => item.sourceClass === "untrusted-tool" || item.sourceClass === "untrusted-user")) {
      return [{ code: "AUTHORITY_ESCALATION" }];
    }
    const claim = state.claims.find((item) => item.claimId === selection.claimId);
    if (claim?.authority && rank[claim.authority] < rank.propose) return [{ code: "AUTHORITY_ESCALATION" }];
  }
  return [];
}

function checkOutcomeAttestation(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const claimsOutcome = proposal.claimSelections.some((item) => item.role === "outcome");
  const saysPassed = proposal.narrative.some((item) => /passed|success|deployed/i.test(item.text));
  if (!claimsOutcome || !saysPassed) return [];
  const cited = new Set(proposal.narrative.flatMap((item) => item.sourceIds));
  const failed = state.evidence.some(
    (item) => cited.has(item.id) && (item.kind === "test" || item.kind === "tool") && item.ok === false,
  );
  return failed ? [{ code: "UNSUPPORTED_OUTCOME" }] : [];
}

function checkDirectiveCoverage(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  for (const directive of state.hardDirectives ?? []) {
    const cited = proposal.narrative.some((item) => item.sourceIds.includes(directive.id));
    if (!directive.covered && !cited) return [{ code: "HARD_DIRECTIVE_UNCOVERED" }];
  }
  return [];
}

function checkMustShrink(state: VerificationState): VerifierGap[] {
  if (state.tokensBefore == null || state.tokensAfter == null) return [];
  return state.tokensAfter >= state.tokensBefore ? [{ code: "MUST_SHRINK" }] : [];
}

function checkNewConcreteEntities(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  return proposal.narrative.some((item) => hasConcreteEntity(item.text, state)) ? [{ code: "NEW_CONCRETE_ENTITY" }] : [];
}

function checkConflictsRetained(proposal: SemanticProposal, state: VerificationState): VerifierGap[] {
  const selected = new Set(proposal.claimSelections.map((item) => item.claimId));
  for (const claim of state.claims) {
    const contested = claim.status === "contested" || (claim.conflictsWith?.length ?? 0) > 0;
    if (contested && !selected.has(claim.claimId)) return [{ code: "CONFLICT_DROPPED" }];
  }
  return [];
}

function unique(gaps: VerifierGap[]): VerifierGap[] {
  return [...new Map(gaps.map((gap) => [gap.code, gap])).values()];
}
