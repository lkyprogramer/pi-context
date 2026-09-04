import { snapshotProviderPrices, type ProviderPrices } from "@pcr/core";

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

export interface PairedMedian {
  baselineMedian: number;
  candidateMedian: number;
  deltaMedian: number;
}

export interface PairedEconomicsMeasurement {
  caseId: string;
  logicalTokens: PairedMedian;
  effectiveInput: PairedMedian;
  monetaryCost: PairedMedian | null;
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
  logicalTokens: PairedMedian;
  effectiveInput: PairedMedian;
  /** Null when any paired sample lacks a complete price + cache-discount snapshot. */
  monetaryCost: PairedMedian | null;
  measurements: ReadonlyArray<PairedEconomicsMeasurement>;
}

export function pairPreservingCost(input: {
  samples: readonly PairedEconomicsSample[];
  prices: ProviderPrices;
  cacheReadPricePerToken?: number;
  cacheReadDiscount?: number;
  cacheWritePricePerToken?: number;
}): PairPreservingReport {
  if (!input || typeof input !== "object") failMissing("input");
  if (!Array.isArray(input.samples) || input.samples.length === 0) failInput("samples");
  const prices = snapshotProviderPrices(input.prices);
  const measurements: PairedEconomicsMeasurement[] = [];
  for (const sample of input.samples) {
    if (!sample || typeof sample.caseId !== "string" || sample.caseId.length === 0) failInput("samples.caseId");
    if (!sample.baseline || !sample.candidate) continue;
    assertUsage(sample.baseline, "baseline");
    assertUsage(sample.candidate, "candidate");
    if (!sample.baseline.succeeded || !sample.candidate.succeeded) continue;
    measurements.push({
      caseId: sample.caseId,
      logicalTokens: pairMetric(sample.baseline.serializedInputTokens, sample.candidate.serializedInputTokens),
      effectiveInput: pairMetric(
        sample.baseline.uncachedInputTokens + sample.baseline.cacheReadTokens,
        sample.candidate.uncachedInputTokens + sample.candidate.cacheReadTokens,
      ),
      monetaryCost: pairMonetaryCost(sample, prices, input),
    });
  }
  const ordered = [...measurements].sort((left, right) => left.caseId.localeCompare(right.caseId));
  const logicalTokens = medianMetric(ordered.map((row) => row.logicalTokens));
  const effectiveInput = medianMetric(ordered.map((row) => row.effectiveInput));
  const monetary = ordered.map((row) => row.monetaryCost);
  return {
    pairs: ordered.length,
    logicalTokens,
    effectiveInput,
    monetaryCost: monetary.some((entry) => entry === null)
      ? null
      : medianMetric(monetary as PairedMedian[]),
    measurements: ordered,
  };
}

function assertUsage(usage: ArmUsage, prefix: string): void {
  for (const field of ["serializedInputTokens", "uncachedInputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"] as const) {
    const value = usage[field];
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      failUsage(`${prefix}.${field}`);
    }
  }
  if (typeof usage.succeeded !== "boolean") failUsage(`${prefix}.succeeded`);
}

function pairMetric(baseline: number, candidate: number): PairedMedian {
  return { baselineMedian: baseline, candidateMedian: candidate, deltaMedian: baseline - candidate };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function medianMetric(values: readonly PairedMedian[]): PairedMedian {
  return {
    baselineMedian: median(values.map((value) => value.baselineMedian)),
    candidateMedian: median(values.map((value) => value.candidateMedian)),
    deltaMedian: median(values.map((value) => value.deltaMedian)),
  };
}

function pairMonetaryCost(
  sample: PairedEconomicsSample,
  prices: ProviderPrices,
  input: { cacheReadPricePerToken?: number; cacheReadDiscount?: number; cacheWritePricePerToken?: number },
): PairedMedian | null {
  const cacheReadRate = cacheReadRateFor(prices, input);
  if (cacheReadRate === null) return null;
  const cacheWriteRate = input.cacheWritePricePerToken;
  if (cacheWriteRate !== undefined && !validPrice(cacheWriteRate)) return null;
  if ((sample.baseline!.cacheWriteTokens > 0 || sample.candidate!.cacheWriteTokens > 0)
    && cacheWriteRate === undefined) return null;
  const baseline = armMonetaryCost(sample.baseline!, prices, cacheReadRate, cacheWriteRate);
  const candidate = armMonetaryCost(sample.candidate!, prices, cacheReadRate, cacheWriteRate);
  return pairMetric(baseline, candidate);
}

function armMonetaryCost(usage: ArmUsage, prices: ProviderPrices, cacheReadRate: number, cacheWriteRate?: number): number {
  return usage.uncachedInputTokens * prices.inputPerToken
    + usage.cacheReadTokens * cacheReadRate
    + usage.cacheWriteTokens * (cacheWriteRate ?? prices.inputPerToken)
    + usage.outputTokens * prices.outputPerToken;
}

function cacheReadRateFor(
  prices: ProviderPrices,
  input: { cacheReadPricePerToken?: number; cacheReadDiscount?: number },
): number | null {
  if (input.cacheReadPricePerToken !== undefined) {
    return validPrice(input.cacheReadPricePerToken) ? input.cacheReadPricePerToken : null;
  }
  if (input.cacheReadDiscount === undefined || !validPrice(input.cacheReadDiscount) || input.cacheReadDiscount > 1) return null;
  return prices.inputPerToken * input.cacheReadDiscount;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
