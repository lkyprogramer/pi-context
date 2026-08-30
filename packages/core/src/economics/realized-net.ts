export interface ProviderPrices {
  inputPerToken: number;
  outputPerToken: number;
}

export interface RealizedNet {
  avoidedInput: number;
  avoidedOverflow: number;
  summaryCost: number;
  recallCost: number;
  cacheRewrite: number;
  failureCost: number;
  net: number;
}

export interface RealizedNetSample {
  tokensBefore: number;
  tokensAfter: number;
  summaryTokens: number;
  recallTokens: number;
  rewriteTokens: number;
  succeeded: boolean;
  overflowAvoided: boolean;
}

export type EconomicsErrorCode =
  | "PCR_ECONOMICS_DEPENDENCY_MISSING"
  | "PCR_ECONOMICS_INPUT_INVALID"
  | "PCR_ECONOMICS_SCOPE_MISMATCH";

export class EconomicsError extends TypeError {
  readonly code: EconomicsErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EconomicsErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "EconomicsError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new EconomicsError("PCR_ECONOMICS_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new EconomicsError("PCR_ECONOMICS_INPUT_INVALID", { field });
}

function requireFiniteNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) failInput(field);
  return value;
}

export function snapshotProviderPrices(value: unknown, field = "prices"): ProviderPrices {
  if (!value || typeof value !== "object") failMissing(field);
  const prices = value as ProviderPrices;
  const inputPerToken = requireFiniteNonNegative(prices.inputPerToken, `${field}.inputPerToken`);
  const outputPerToken = requireFiniteNonNegative(prices.outputPerToken, `${field}.outputPerToken`);
  if (inputPerToken === 0 && outputPerToken === 0) failInput(field);
  return { inputPerToken, outputPerToken };
}

export function computeRealizedNet(sample: RealizedNetSample, prices: ProviderPrices): RealizedNet {
  if (!sample || typeof sample !== "object") failInput("sample");
  if (typeof sample.succeeded !== "boolean") failInput("sample.succeeded");
  if (typeof sample.overflowAvoided !== "boolean") failInput("sample.overflowAvoided");
  const tokensBefore = requireFiniteNonNegative(sample.tokensBefore, "sample.tokensBefore");
  const tokensAfter = requireFiniteNonNegative(sample.tokensAfter, "sample.tokensAfter");
  const summaryTokens = requireFiniteNonNegative(sample.summaryTokens, "sample.summaryTokens");
  const recallTokens = requireFiniteNonNegative(sample.recallTokens, "sample.recallTokens");
  const rewriteTokens = requireFiniteNonNegative(sample.rewriteTokens, "sample.rewriteTokens");
  const priced = snapshotProviderPrices(prices);
  const summaryCost = summaryTokens * priced.outputPerToken;
  const recallCost = recallTokens * priced.inputPerToken;
  const cacheRewrite = rewriteTokens * priced.inputPerToken;
  const avoidedInput = sample.succeeded ? Math.max(0, tokensBefore - tokensAfter) * priced.inputPerToken : 0;
  const avoidedOverflow = sample.succeeded && sample.overflowAvoided ? tokensAfter * priced.inputPerToken : 0;
  const failureCost = sample.succeeded ? 0 : tokensBefore * priced.inputPerToken;
  return {
    avoidedInput,
    avoidedOverflow,
    summaryCost,
    recallCost,
    cacheRewrite,
    failureCost,
    net: avoidedInput + avoidedOverflow - summaryCost - recallCost - cacheRewrite - failureCost,
  };
}
