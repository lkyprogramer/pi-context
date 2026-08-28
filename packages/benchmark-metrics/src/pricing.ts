export interface PriceBook {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion: number;
  readonly cacheWritePerMillion: number;
}

export function providerCost(
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
  price: PriceBook,
): number {
  return (
    (usage.input * price.inputPerMillion +
      usage.output * price.outputPerMillion +
      usage.cacheRead * price.cacheReadPerMillion +
      usage.cacheWrite * price.cacheWritePerMillion) /
    1_000_000
  );
}
