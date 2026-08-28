import { providerCost, type PriceBook } from "./pricing.js";

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface EconomicsInput {
  usage: ProviderUsage;
  price: PriceBook;
  spans: readonly { name: string; ms: number }[];
  qualityGatePassed: boolean;
}

export interface RealizedNetInput {
  qualityGatePassed: boolean;
  avoidedInputCost: number;
  avoidedOverflowCost: number;
  summaryCost: number;
  cacheRewriteCost: number;
  recallCost: number;
  backgroundWasteCost: number;
  configuredLatencyCost: number;
}

export function measureEconomics(input: EconomicsInput) {
  return {
    providerCost: providerCost(input.usage, input.price),
    hookP95Ms: input.spans.length === 0 ? 0 : Math.max(...input.spans.map((span) => span.ms)),
    qualityGatePassed: input.qualityGatePassed,
  };
}

export function computeRealizedNet(input: RealizedNetInput): number {
  if (!input.qualityGatePassed) {
    throw new Error("quality gate failed; token savings cannot offset quality");
  }
  return (
    input.avoidedInputCost +
    input.avoidedOverflowCost -
    input.summaryCost -
    input.cacheRewriteCost -
    input.recallCost -
    input.backgroundWasteCost -
    input.configuredLatencyCost
  );
}
