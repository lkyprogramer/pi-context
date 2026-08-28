export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo]!;
  return xs[lo]! * (hi - pos) + xs[hi]! * (pos - lo);
}
