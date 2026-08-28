import { oppositePolarity, type ClaimTransitionResult } from "./transitions.js";
import type { Claim } from "./model.js";

export function projectCurrent(claims: readonly Claim[]): Claim[] {
  return claims.filter((claim) => claim.status === "active" && claim.systemTime.end == null);
}

export function projectAudit(claims: readonly Claim[]): Claim[] {
  return [...claims];
}

export function conflictSet(claims: readonly Claim[]): Claim[][] {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    const bucket = groups.get(claim.key) ?? [];
    bucket.push(claim);
    groups.set(claim.key, bucket);
  }
  return [...groups.values()].filter((group) => {
    if (group.some((item) => item.status === "contested")) return true;
    const active = group.filter((item) => item.status === "active");
    if (active.length < 2) return false;
    return active.some((left, index) =>
      active.slice(index + 1).some((right) => oppositePolarity(left, right) || JSON.stringify(left.value) !== JSON.stringify(right.value)),
    );
  });
}

export function applyTransitionToSlice(
  claims: readonly Claim[],
  current: Claim,
  result: ClaimTransitionResult,
): Claim[] {
  if (result.kind === "rejected") return [...claims];
  if (result.kind === "contested") {
    return claims.map((item) =>
      item.claimId === current.claimId
        ? { ...item, status: "contested", conflictsWith: [...new Set([...item.conflictsWith, result.challenger.claimId])] }
        : item,
    ).concat({ ...result.challenger, status: "contested", conflictsWith: [...new Set([...result.challenger.conflictsWith, current.claimId])] });
  }
  if (result.kind === "retracted") {
    return claims.map((item) => (item.claimId === current.claimId ? result.current : item));
  }
  return claims
    .map((item) => (item.claimId === current.claimId ? result.current : item))
    .concat(result.next);
}
