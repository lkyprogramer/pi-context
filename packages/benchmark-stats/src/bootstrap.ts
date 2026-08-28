export interface BootstrapOptions {
  samples: number;
  seed: number;
  statistic: "mean" | "median";
}

export interface PairRow {
  key: string;
  baseline: number;
  candidate: number;
}

function statisticOf(values: readonly number[], name: "mean" | "median"): number {
  const xs = [...values].sort((a, b) => a - b);
  if (name === "mean") return xs.reduce((a, b) => a + b, 0) / xs.length;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

function percentile(values: readonly number[], p: number): number {
  const xs = [...values].sort((a, b) => a - b);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo]!;
  return xs[lo]! * (hi - pos) + xs[hi]! * (pos - lo);
}

class Mulberry32 {
  constructor(private state: number) {}
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export function pairedBootstrap(input: readonly PairRow[], options: BootstrapOptions) {
  const diffs = input.map((row) => row.candidate - row.baseline);
  const rng = new Mulberry32(options.seed);
  const boots: number[] = [];
  for (let i = 0; i < options.samples; i += 1) {
    const draw = diffs.map(() => diffs[Math.floor(rng.next() * diffs.length)]!);
    boots.push(statisticOf(draw, options.statistic));
  }
  return {
    estimate: statisticOf(diffs, options.statistic),
    lower: percentile(boots, 0.025),
    upper: percentile(boots, 0.975),
  };
}
