export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1));
  return xs[idx] ?? 0;
}

export function predictNextStepGrowth(samples: readonly number[], fallback = 256): number {
  if (samples.length === 0) return fallback;
  return Math.max(fallback, percentile([...samples], 0.95));
}

export function predictedPressure(materialized: number, growth: number, effectiveInput: number): number {
  const qPred = materialized + growth;
  return effectiveInput === 0 ? Number.POSITIVE_INFINITY : qPred / effectiveInput;
}
