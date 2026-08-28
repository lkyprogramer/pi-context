import type { Claim } from "./model.js";

export type ClaimTransitionResult =
  | { kind: "superseded"; current: Claim; next: Claim }
  | { kind: "contested"; current: Claim; challenger: Claim }
  | { kind: "rejected"; reason: "invalid-transition" | "unknown-strategy"; current: Claim; incoming: Claim }
  | { kind: "retracted"; current: Claim };

export function closeSystemTime(claim: Claim, end: number): Claim {
  return { ...claim, status: "superseded", systemTime: { start: claim.systemTime.start, end } };
}

export function explicitSupersession(current: Claim, incoming: Claim): boolean {
  return incoming.authority === "act" && incoming.supersedes.includes(current.claimId);
}

export function oppositePolarity(left: Claim, right: Claim): boolean {
  return (
    (left.polarity === "must" && right.polarity === "must-not") ||
    (left.polarity === "must-not" && right.polarity === "must") ||
    (left.polarity === "is" && right.polarity === "is-not") ||
    (left.polarity === "is-not" && right.polarity === "is")
  );
}

export function valuesConflict(current: Claim, incoming: Claim): boolean {
  return oppositePolarity(current, incoming) || JSON.stringify(current.value) !== JSON.stringify(incoming.value);
}

export function authorizedRetraction(current: Claim, incoming: Claim): boolean {
  if (incoming.status !== "retracted") return false;
  return incoming.authority === "act" || incoming.authority === current.authority;
}

export function transitionPolicyAllows(current: Claim, incoming: Claim): boolean {
  if (incoming.polarity === "unknown") return false;
  if (incoming.status === "retracted") return authorizedRetraction(current, incoming);
  if (explicitSupersession(current, incoming)) return true;
  if (incoming.authority === "act" && current.authority === "act" && incoming.supersedes.includes(current.claimId)) {
    return true;
  }
  return false;
}

export function applyClaimTransition(current: Claim, incoming: Claim): ClaimTransitionResult {
  if (incoming.polarity === "unknown") {
    return { kind: "rejected", reason: "unknown-strategy", current, incoming };
  }
  if (incoming.status === "retracted") {
    if (!authorizedRetraction(current, incoming)) {
      return { kind: "rejected", reason: "invalid-transition", current, incoming };
    }
    return {
      kind: "retracted",
      current: { ...current, status: "retracted", systemTime: { start: current.systemTime.start, end: incoming.systemTime.start } },
    };
  }
  if (incoming.authority !== "act" && current.authority === "act") {
    return { kind: "contested", current, challenger: incoming };
  }
  if (valuesConflict(current, incoming) && !explicitSupersession(current, incoming)) {
    return { kind: "contested", current, challenger: incoming };
  }
  if (!transitionPolicyAllows(current, incoming)) {
    return { kind: "rejected", reason: "invalid-transition", current, incoming };
  }
  return {
    kind: "superseded",
    current: closeSystemTime(current, incoming.systemTime.start),
    next: { ...incoming, status: "active", supersedes: [...new Set([...incoming.supersedes, current.claimId])] },
  };
}
