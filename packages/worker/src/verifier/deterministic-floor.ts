import type { VerificationState } from "./verifier.js";

export interface DeterministicFloor {
  kind: "deterministic-floor";
  sourceHead: string;
  claimIds: string[];
  frontIds: string[];
}

export function deterministicFloor(state: VerificationState): DeterministicFloor {
  return {
    kind: "deterministic-floor",
    sourceHead: state.sourceHead,
    claimIds: [...state.knownClaimIds],
    frontIds: [...state.knownFrontIds],
  };
}
