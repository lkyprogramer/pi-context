import { defineBenchmarkContracts, type GateDecision } from "../../benchmark-contracts/src/index.js";

export interface GateEvaluationInput {
  gate: "w1-early-net-value" | "w2-compactor" | "semantic-beta";
  integrityPass: boolean;
  qualityCiLower: number;
  qualityMargin: number;
  ingressTokenMedianDelta: number;
  ingressTokenCiUpper: number;
  hookP95Ms: number;
  recallAt5: number;
  recallPrecision: number;
  silenceRate: number;
  recallQualityCiLower: number;
  recallQualityMargin: number;
  recallNeededSuccessDelta: number;
  realizedNetMedian: number;
  runId?: string;
}

export function evaluateBenchmarkGate(input: GateEvaluationInput): GateDecision {
  let decision: GateDecision["decision"] = "stop";
  const reasons: string[] = [];
  if (!input.integrityPass || input.qualityCiLower < -input.qualityMargin) {
    decision = "stop";
    reasons.push("Hard gates failed");
  } else {
    const ingress =
      input.ingressTokenMedianDelta <= -0.2 && input.ingressTokenCiUpper <= -0.1 && input.hookP95Ms <= 75;
    const recall =
      input.recallAt5 >= 0.9 &&
      input.recallPrecision >= 0.75 &&
      input.silenceRate >= 0.9 &&
      input.recallQualityCiLower >= -input.recallQualityMargin &&
      input.recallNeededSuccessDelta > 0;
    if (ingress && recall && input.realizedNetMedian > 0) {
      decision = "proceed-to-w2";
      reasons.push("Hard gates passed", "A1 reduced tool-heavy input tokens", "A2 improved recall-needed success without overall regression");
    } else if (ingress) {
      decision = "keep-reducers-only";
      reasons.push("Ingress value holds; proactive recall missed its gate");
    } else if (input.realizedNetMedian >= 0) {
      decision = "keep-recovery-only";
      reasons.push("Recovery holds without ingress/recall value");
    } else {
      decision = "stop";
      reasons.push("No positive net value");
    }
  }
  return defineBenchmarkContracts().parseGateDecision({
    runId: input.runId ?? "run-gate",
    gate: input.gate,
    decision,
    hardGatePass: Boolean(input.integrityPass && input.qualityCiLower >= -input.qualityMargin),
    reasons,
    reportSha256: "3".repeat(64),
  });
}
