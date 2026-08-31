export { attestOutcome, type ClaimTransition, type OutcomeAttestation, type OutcomeKind } from "@pcr/core";

import type { RuntimeCursor } from "@pcr/contracts";

export function denyCrossScopeClaim(expected: RuntimeCursor, actual: RuntimeCursor): void {
  const mismatch = expected.workspaceId !== actual.workspaceId
    || expected.sessionId !== actual.sessionId
    || expected.leafId !== actual.leafId
    || expected.lineageHash !== actual.lineageHash
    || expected.modelKey !== actual.modelKey;
  if (mismatch) {
    throw Object.assign(new Error("PCR_CLAIM_SCOPE_MISMATCH"), { code: "PCR_CLAIM_SCOPE_MISMATCH" });
  }
}
