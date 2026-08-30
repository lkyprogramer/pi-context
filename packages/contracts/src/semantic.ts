export interface ProposedClaim {
  claimId: string;
  key: string;
  polarity: string;
  status: string;
  value: unknown;
  sourceRefs: string[];
}

export interface SemanticProposal {
  proposalId: string;
  sourceRefs: string[];
  claims: ProposedClaim[];
  continuityPatch: unknown;
}
