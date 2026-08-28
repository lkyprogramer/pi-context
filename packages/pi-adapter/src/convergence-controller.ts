import { decideHostConvergence, type ConvergenceDecision, type ConvergencePolicy, type HostMetrics } from "../../kernel/src/control/convergence.js";

export interface SettledCompactCtx {
  compact(): void;
  busy?: boolean;
}

export function requestSettledCompaction(
  ctx: SettledCompactCtx,
  metrics: HostMetrics,
  policy: ConvergencePolicy,
): ConvergenceDecision {
  const decision = decideHostConvergence(metrics, policy);
  if (decision.kind === "compact" && ctx.busy !== true) ctx.compact();
  return decision;
}
