import { pairedBootstrap } from "./bootstrap.js";

export interface PairedStatisticsInput {
  metric: string;
  baseline: readonly { key: string; value: number }[];
  candidate: readonly { key: string; value: number }[];
  failurePolicy: "count-arm-failure" | "drop";
}

export function computePairedStatistics(input: PairedStatisticsInput) {
  const baselineKeys = new Set(input.baseline.map((row) => row.key));
  const candidateKeys = new Set(input.candidate.map((row) => row.key));
  const missing = [...baselineKeys].filter((key) => !candidateKeys.has(key));
  const extra = [...candidateKeys].filter((key) => !baselineKeys.has(key));
  const errors: string[] = [];
  if (missing.length > 0 || extra.length > 0) {
    errors.push(`missing pair: ${[...missing, ...extra].join(",")}`);
  }
  const pairs = input.baseline
    .filter((row) => candidateKeys.has(row.key))
    .map((row) => ({
      key: row.key,
      baseline: row.value,
      candidate: input.candidate.find((item) => item.key === row.key)?.value ?? 0,
    }));
  const boot = pairs.length > 0 ? pairedBootstrap(pairs, { samples: 1000, seed: 7, statistic: "mean" }) : { estimate: 0, lower: 0, upper: 0 };
  return {
    metric: input.metric,
    sampleIntegrity: { ok: errors.length === 0, errors },
    bootstrap: boot,
  };
}

export { pairedBootstrap };
