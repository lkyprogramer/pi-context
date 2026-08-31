import type { ActionAuthority } from "@pcr/contracts";

export type OutcomeKind = "tests-passed" | "deployed" | "deleted";

export interface OutcomeAttestation {
  outcome: OutcomeKind;
  source: "assistant" | "tool";
  toolSucceeded: boolean;
  toolName?: string;
}

export interface ClaimTransition {
  key: string;
  authority: ActionAuthority;
  accepted: boolean;
  reason: string;
}

const HIGH_RISK = new Set<OutcomeKind>(["deployed", "deleted"]);
const SUCCESS_TOOLS: Record<OutcomeKind, readonly string[]> = {
  "tests-passed": ["test", "vitest", "pytest", "npm"],
  deployed: ["deploy", "kubectl", "helm"],
  deleted: ["rm", "delete"],
};

export function attestOutcome(input: OutcomeAttestation): ClaimTransition {
  if (!input || typeof input !== "object") {
    return { key: "outcome", authority: "none", accepted: false, reason: "PCR_CLAIM_INPUT_INVALID" };
  }
  if (input.source === "assistant") {
    return {
      key: input.outcome,
      authority: "propose",
      accepted: false,
      reason: "assistant-claim-unattested",
    };
  }
  if (HIGH_RISK.has(input.outcome) && !input.toolSucceeded) {
    return {
      key: input.outcome,
      authority: "none",
      accepted: false,
      reason: "high-risk-outcome-unattested",
    };
  }
  const allowed = SUCCESS_TOOLS[input.outcome] ?? [];
  const toolName = input.toolName ?? "";
  const matched = allowed.some((name) => toolName.includes(name));
  if (!input.toolSucceeded || !matched) {
    return {
      key: input.outcome,
      authority: "inform",
      accepted: false,
      reason: "tool-failure-or-mismatch",
    };
  }
  return {
    key: input.outcome,
    authority: "act",
    accepted: true,
    reason: "tool-attested",
  };
}
