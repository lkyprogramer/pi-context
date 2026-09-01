export type W1Decision = "proceed-to-w2" | "keep-reducers-only" | "keep-recovery-only" | "stop";

export interface W1EconomicsInput {
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
}

export type HookP95Source = "recorded" | "measured";

export function hookP95ForDecision(input: {
  recordedMs: number;
  measuredMs: number;
  source: HookP95Source;
}): number {
  if (!input || typeof input !== "object") {
    throw Object.assign(new TypeError("PCR_W1_TIMING_INPUT_INVALID"), { code: "PCR_W1_TIMING_INPUT_INVALID" });
  }
  if (!Number.isFinite(input.recordedMs) || !Number.isFinite(input.measuredMs)) {
    throw Object.assign(new TypeError("PCR_W1_TIMING_INPUT_INVALID"), { code: "PCR_W1_TIMING_INPUT_INVALID", details: { field: "ms" } });
  }
  if (input.source !== "recorded" && input.source !== "measured") {
    throw Object.assign(new TypeError("PCR_W1_TIMING_INPUT_INVALID"), { code: "PCR_W1_TIMING_INPUT_INVALID", details: { field: "source" } });
  }
  return input.source === "recorded" ? input.recordedMs : input.measuredMs;
}

export function evaluateW1Economics(input: W1EconomicsInput): W1Decision {
  if (!input || typeof input !== "object") {
    throw Object.assign(new TypeError("PCR_W1_DECISION_INPUT_INVALID"), { code: "PCR_W1_DECISION_INPUT_INVALID" });
  }
  if (!input.integrityPass || input.qualityCiLower < -input.qualityMargin) return "stop";
  const ingress =
    input.ingressTokenMedianDelta <= -0.2 && input.ingressTokenCiUpper <= -0.1 && input.hookP95Ms <= 75;
  const recall =
    input.recallAt5 >= 0.9 &&
    input.recallPrecision >= 0.75 &&
    input.silenceRate >= 0.9 &&
    input.recallQualityCiLower >= -input.recallQualityMargin &&
    input.recallNeededSuccessDelta > 0;
  if (ingress && recall && input.realizedNetMedian > 0) return "proceed-to-w2";
  if (ingress) return "keep-reducers-only";
  return input.realizedNetMedian >= 0 ? "keep-recovery-only" : "stop";
}
