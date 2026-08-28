import type { ActionAuthority } from "../../../contracts/src/index.js";
import { minAuthority } from "../evidence/model.js";
import { canonicalClaim, type Claim, type ClaimAdmission, type ClaimSupport } from "./model.js";

export function supportMissing(code = "PCR_CLAIM_SUPPORT_MISSING"): Error {
  return Object.assign(new Error(code), { code });
}

export function resolveSupportClosure(
  requestedIds: readonly string[],
  loaded: readonly ClaimSupport[],
): ClaimSupport[] {
  if (loaded.length !== requestedIds.length) throw supportMissing();
  const byId = new Map(loaded.map((item) => [item.evidenceId, item]));
  return requestedIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw supportMissing();
    return item;
  });
}

export function boundClaimAuthority(
  supports: readonly ClaimSupport[],
  transformerCeiling: ActionAuthority,
): ActionAuthority {
  return supports.reduce((lowest, item) => minAuthority(lowest, item.authority), transformerCeiling);
}

export function admitClaim(input: ClaimAdmission, supports: readonly ClaimSupport[]): Claim {
  const closed = resolveSupportClosure(input.supportIds, supports);
  const authority = boundClaimAuthority(closed, input.transformerCeiling);
  return canonicalClaim({ ...input, authority, status: "active" });
}

export function quarantineInference(input: ClaimAdmission): Claim {
  const ceiling = minAuthority(input.transformerCeiling, "propose");
  return canonicalClaim({ ...input, authority: ceiling, status: "contested" });
}

export function isInferenceAdmission(input: ClaimAdmission): boolean {
  return input.admissionClass === "inference" || input.admissionClass === "proposal";
}
