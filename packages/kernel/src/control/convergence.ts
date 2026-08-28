export interface HostMetrics {
  messageCount: number;
  cloneP95Ms: number;
  pressure: number;
  grewSinceLast: number;
  atBoundary?: boolean;
  streaming?: boolean;
  midTool?: boolean;
  cooldownActive?: boolean;
  queuedMessages?: number;
  overflow?: boolean;
  lastCompactFailed?: boolean;
}

export interface ConvergencePolicy {
  hardRatio: number;
  softRatio: number;
  maxHostMessages: number;
  maxCloneP95Ms: number;
  minGrowth: number;
}

export type ConvergenceDecision =
  | { kind: "compact"; reason: "hard-pressure" | "clone-cost" | "soft-pressure" | "overflow" }
  | { kind: "defer"; reason?: "in-flight" | "cooldown" | "queued" | "no-loop" | "growth" };

export function balancedPolicy(): ConvergencePolicy {
  return {
    hardRatio: 0.9,
    softRatio: 0.7,
    maxHostMessages: 800,
    maxCloneP95Ms: 80,
    minGrowth: 50,
  };
}

export function decideHostConvergence(metrics: HostMetrics, policy: ConvergencePolicy): ConvergenceDecision {
  const inFlight = metrics.streaming === true || metrics.midTool === true;
  if (inFlight && !metrics.overflow) return { kind: "defer", reason: "in-flight" };
  if (metrics.lastCompactFailed && !metrics.overflow && metrics.pressure < policy.hardRatio) {
    return { kind: "defer", reason: "no-loop" };
  }
  if ((metrics.queuedMessages ?? 0) > 0 && !metrics.overflow) return { kind: "defer", reason: "queued" };
  if (metrics.cooldownActive && metrics.pressure < policy.hardRatio && !metrics.overflow) {
    return { kind: "defer", reason: "cooldown" };
  }
  if (metrics.overflow) return { kind: "compact", reason: "overflow" };
  if (metrics.pressure >= policy.hardRatio) return { kind: "compact", reason: "hard-pressure" };
  if (metrics.messageCount >= policy.maxHostMessages || metrics.cloneP95Ms >= policy.maxCloneP95Ms) {
    return { kind: "compact", reason: "clone-cost" };
  }
  if (metrics.pressure >= policy.softRatio && metrics.grewSinceLast >= policy.minGrowth && metrics.atBoundary) {
    return { kind: "compact", reason: "soft-pressure" };
  }
  if (metrics.grewSinceLast < policy.minGrowth) return { kind: "defer", reason: "growth" };
  return { kind: "defer" };
}
