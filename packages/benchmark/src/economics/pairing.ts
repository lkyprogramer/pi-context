import { computeRealizedNet, snapshotProviderPrices, type ProviderPrices, type RealizedNet } from "@pcr/core";

export type EconomicsPairErrorCode =
  | "PCR_ECONOMICS_PAIR_DEPENDENCY_MISSING"
  | "PCR_ECONOMICS_PAIR_INPUT_INVALID"
  | "PCR_ECONOMICS_PAIR_USAGE_MISSING";

export class EconomicsPairError extends TypeError {
  readonly code: EconomicsPairErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EconomicsPairErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "EconomicsPairError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new EconomicsPairError("PCR_ECONOMICS_PAIR_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new EconomicsPairError("PCR_ECONOMICS_PAIR_INPUT_INVALID", { field });
}

function failUsage(field: string): never {
  throw new EconomicsPairError("PCR_ECONOMICS_PAIR_USAGE_MISSING", { field });
}

export interface ArmUsage {
  serializedInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  succeeded: boolean;
}

export interface PairedEconomicsSample {
  caseId: string;
  baseline?: ArmUsage;
  candidate?: ArmUsage;
  summaryTokens: number;
  recallTokens: number;
  rewriteTokens: number;
  overflowAvoided: boolean;
}

export interface PairPreservingReport {
  pairs: number;
  capacityDeltaMedian: number;
  costDeltaMedian: number;
  netMedian: number;
  nets: ReadonlyArray<{ caseId: string; net: RealizedNet }>;
}

export function pairPreservingCost(input: {
  samples: readonly PairedEconomicsSample[];
  prices: ProviderPrices;
  cacheReadPricePerToken?: number;
}): PairPreservingReport {
  if (!input || typeof input !== "object") failMissing("input");
  if (!Array.isArray(input.samples) || input.samples.length === 0) failInput("samples");
  const prices = snapshotProviderPrices(input.prices);
  const nets: Array<{ caseId: string; net: RealizedNet }> = [];
  for (const sample of input.samples) {
    if (!sample || typeof sample.caseId !== "string" || sample.caseId.length === 0) failInput("samples.caseId");
    if (!sample.baseline || !sample.candidate) continue;
    if (typeof sample.baseline.serializedInputTokens !== "number") failUsage("baseline.serializedInputTokens");
    if (typeof sample.candidate.serializedInputTokens !== "number") failUsage("candidate.serializedInputTokens");
    if (!sample.baseline.succeeded || !sample.candidate.succeeded) continue;
    const cacheReadPrice = input.cacheReadPricePerToken ?? 0;
    const baselineCost = sample.baseline.uncachedInputTokens * prices.inputPerToken
      + sample.baseline.cacheReadTokens * cacheReadPrice
      + sample.baseline.outputTokens * prices.outputPerToken;
    const candidateCost = sample.candidate.uncachedInputTokens * prices.inputPerToken
      + sample.candidate.cacheReadTokens * cacheReadPrice
      + sample.candidate.outputTokens * prices.outputPerToken;
    const net = computeRealizedNet({
      tokensBefore: sample.baseline.serializedInputTokens,
      tokensAfter: sample.candidate.serializedInputTokens,
      summaryTokens: sample.summaryTokens,
      recallTokens: sample.recallTokens,
      rewriteTokens: sample.rewriteTokens,
      succeeded: true,
      overflowAvoided: sample.overflowAvoided,
    }, prices);
    nets.push({
      caseId: sample.caseId,
      net: { ...net, avoidedInput: net.avoidedInput + (baselineCost - candidateCost) },
    });
  }
  const ordered = [...nets].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const values = ordered.map((row) => row.net.net);
  const mid = Math.floor(values.length / 2);
  const netMedian = values.length === 0
    ? 0
    : values.length % 2 === 1
      ? [...values].sort((a, b) => a - b)[mid]!
      : (([...values].sort((a, b) => a - b)[mid - 1]! + [...values].sort((a, b) => a - b)[mid]!) / 2);
  const capacity = ordered.map((row) => row.net.avoidedInput);
  const capacityDeltaMedian = capacity.length === 0 ? 0 : [...capacity].sort((a, b) => a - b)[Math.floor(capacity.length / 2)]!;
  return {
    pairs: ordered.length,
    capacityDeltaMedian,
    costDeltaMedian: netMedian,
    netMedian,
    nets: ordered,
  };
}
