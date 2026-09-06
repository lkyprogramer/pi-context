export interface MeanPair {
  caseId: string;
  clusterId: string;
  baseline: number;
  candidate: number;
}

export interface BinarySuccessPair {
  caseId: string;
  clusterId: string;
  baseline: boolean;
  candidate: boolean;
}

export interface Discordance {
  bothPass: number;
  baselineOnly: number;
  candidateOnly: number;
  bothFail: number;
}

export interface PairedMeanReport {
  pairs: number;
  clusters: number;
  meanDiff: number;
  clusterMeanDiff: number;
  discordance: Discordance;
}

export type PairedSmallErrorCode = "PCR_PAIRED_INPUT_INVALID";

export class PairedSmallError extends TypeError {
  readonly code: PairedSmallErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: PairedSmallErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "PairedSmallError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new PairedSmallError("PCR_PAIRED_INPUT_INVALID", { field });
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function discordance(pairs: readonly BinarySuccessPair[]): Discordance {
  const counts: Discordance = { bothPass: 0, baselineOnly: 0, candidateOnly: 0, bothFail: 0 };
  for (const [index, row] of pairs.entries()) {
    if (!row || typeof row !== "object") failInput(`pairs[${index}]`);
    if (row.baseline && row.candidate) counts.bothPass += 1;
    else if (row.baseline && !row.candidate) counts.baselineOnly += 1;
    else if (!row.baseline && row.candidate) counts.candidateOnly += 1;
    else counts.bothFail += 1;
  }
  return counts;
}

/** Pairwise mean difference. Cluster means are averaged with equal cluster weight, never a median CI. */
export function pairedMeanDifference(pairs: readonly MeanPair[]): PairedMeanReport {
  if (!Array.isArray(pairs) || pairs.length === 0) failInput("pairs");
  const seen = new Set<string>();
  const grouped = new Map<string, number[]>();
  const deltas: number[] = [];
  for (const [index, row] of pairs.entries()) {
    if (!row || typeof row !== "object") failInput(`pairs[${index}]`);
    if (typeof row.caseId !== "string" || row.caseId.length === 0) failInput(`pairs[${index}].caseId`);
    if (typeof row.clusterId !== "string" || row.clusterId.length === 0) failInput(`pairs[${index}].clusterId`);
    if (typeof row.baseline !== "number" || !Number.isFinite(row.baseline)) failInput(`pairs[${index}].baseline`);
    if (typeof row.candidate !== "number" || !Number.isFinite(row.candidate)) failInput(`pairs[${index}].candidate`);
    if (seen.has(row.caseId)) failInput(`pairs[${index}].caseId`);
    seen.add(row.caseId);
    const delta = row.candidate - row.baseline;
    deltas.push(delta);
    const bucket = grouped.get(row.clusterId) ?? [];
    bucket.push(delta);
    grouped.set(row.clusterId, bucket);
  }
  const clusterMeans = [...grouped.values()].map((items) => mean(items));
  return {
    pairs: pairs.length,
    clusters: clusterMeans.length,
    meanDiff: mean(deltas),
    clusterMeanDiff: mean(clusterMeans),
    discordance: discordance(pairs.map((row) => ({
      caseId: row.caseId,
      clusterId: row.clusterId,
      baseline: row.baseline > 0,
      candidate: row.candidate > 0,
    }))),
  };
}

export function resampleClusterMeans(input: {
  pairs: readonly MeanPair[];
  seed: number;
  draws: number;
}): { estimate: number; samples: number[] } {
  const report = pairedMeanDifference(input.pairs);
  if (!Number.isSafeInteger(input.seed)) failInput("seed");
  if (!Number.isSafeInteger(input.draws) || input.draws < 1) failInput("draws");
  const grouped = new Map<string, number[]>();
  for (const row of input.pairs) {
    const bucket = grouped.get(row.clusterId) ?? [];
    bucket.push(row.candidate - row.baseline);
    grouped.set(row.clusterId, bucket);
  }
  const clusterMeans = [...grouped.keys()].sort().map((name) => mean(grouped.get(name) ?? []));
  const rng = mulberry32(input.seed);
  const samples: number[] = [];
  for (let draw = 0; draw < input.draws; draw += 1) {
    let sum = 0;
    for (let index = 0; index < clusterMeans.length; index += 1) {
      sum += clusterMeans[Math.floor(rng() * clusterMeans.length)] ?? 0;
    }
    samples.push(sum / clusterMeans.length);
  }
  return { estimate: report.clusterMeanDiff, samples };
}
