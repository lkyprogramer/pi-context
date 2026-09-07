import { median, pairedBootstrapCi, relativeDelta } from "../w1-gate/scorer.js";

export { median, pairedBootstrapCi, relativeDelta };

export type W2Decision = "proceed-to-semantic" | "adopt-pcr-compactor" | "keep-pi-native";

export interface W2GateInput {
  hardGatePass: boolean;
  qualityCiLower: number;
  polarityCiLower: number;
  timeCiLower: number;
  updateCiLower: number;
  abstentionCiLower: number;
  qualityMargin: number;
  closedLoopSuccessCiLower: number;
  constraintViolationsCandidate: number;
  constraintViolationsBaseline: number;
  tokenMedianRelativeDelta: number;
  costPerSuccessRelativeDelta: number;
  overflowRecoveryBetter: boolean;
  overflowQualityNonInferior: boolean;
  realizedNetMedian: number;
  budgetMismatchRate: number;
}

export function evaluateW2Gate(input: W2GateInput): W2Decision {
  const margin = input.qualityMargin;
  if (!input.hardGatePass) return "keep-pi-native";
  if (input.qualityCiLower < -margin) return "keep-pi-native";
  if (input.polarityCiLower < -margin) return "keep-pi-native";
  if (input.timeCiLower < -margin) return "keep-pi-native";
  if (input.updateCiLower < -margin) return "keep-pi-native";
  if (input.abstentionCiLower < -margin) return "keep-pi-native";
  if (input.closedLoopSuccessCiLower < -margin) return "keep-pi-native";
  if (input.constraintViolationsCandidate > input.constraintViolationsBaseline) return "keep-pi-native";
  if (input.realizedNetMedian <= 0) return "keep-pi-native";

  const tokenWin = input.budgetMismatchRate === 0 && input.tokenMedianRelativeDelta <= -0.15;
  const costWin = input.costPerSuccessRelativeDelta <= -0.1;
  const overflowWin = input.overflowRecoveryBetter && input.overflowQualityNonInferior;
  if (!tokenWin && !costWin && !overflowWin) return "keep-pi-native";
  return "proceed-to-semantic";
}
