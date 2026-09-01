export function relativeDelta(candidate: number, baseline: number): number {
  return (candidate - baseline) / Math.max(Math.abs(baseline), 1);
}

export function pairedDifferences(baseline: number[], candidate: number[]): number[] {
  if (baseline.length !== candidate.length || baseline.length === 0) {
    throw new Error("paired samples must be non-empty and equal length");
  }
  return baseline.map((value, index) => (candidate[index] ?? 0) - value);
}

export function percentile(values: number[], p: number): number {
  const xs = [...values].sort((a, b) => a - b);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo] ?? 0;
  return (xs[lo] ?? 0) * (hi - pos) + (xs[hi] ?? 0) * (pos - lo);
}

export function median(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 0) return ((xs[mid - 1] ?? 0) + (xs[mid] ?? 0)) / 2;
  return xs[mid] ?? 0;
}

export function pairedBootstrapCi(
  baseline: number[],
  candidate: number[],
  opts: { statistic?: (values: number[]) => number; samples?: number; seed?: number; alpha?: number } = {},
): { estimate: number; lower: number; upper: number } {
  const diffs = pairedDifferences(baseline, candidate);
  const statistic = opts.statistic ?? median;
  const samples = opts.samples ?? 10_000;
  const seed = opts.seed ?? 20260827;
  const alpha = opts.alpha ?? 0.05;
  let state = seed;
  const rand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const boots: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const draw = diffs.map(() => diffs[Math.floor(rand() * diffs.length)] ?? 0);
    boots.push(statistic(draw));
  }
  return {
    estimate: statistic(diffs),
    lower: percentile(boots, alpha / 2),
    upper: percentile(boots, 1 - alpha / 2),
  };
}

import {
  evaluateW1Economics,
  type W1Decision,
  type W1EconomicsInput,
} from "@pcr/benchmark";

export type W1GateInput = W1EconomicsInput;

export function evaluateW1Gate(input: W1GateInput): W1Decision {
  return evaluateW1Economics(input);
}
