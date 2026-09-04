export interface ClusterBootstrapResult {
  estimate: number;
  lower: number;
  upper: number;
  clusters: number;
  pairs: number;
}

export interface McNemarResult {
  bothPass: number;
  baselineOnly: number;
  candidateOnly: number;
  bothFail: number;
  discordant: number;
  clusters: number;
  pairs: number;
}

export interface ClusterCatalog {
  corpusId: string;
  clusters: Record<string, readonly string[]>;
}

export interface NumericPair {
  caseId: string;
  baseline: number;
  candidate: number;
}

export interface BinaryPair {
  caseId: string;
  baseline: boolean;
  candidate: boolean;
}

export interface BootstrapInput {
  corpusId: string;
  pairs: readonly NumericPair[];
  seed: number;
  draws?: number;
  signal?: AbortSignal;
}

export interface McNemarInput {
  corpusId: string;
  pairs: readonly BinaryPair[];
  signal?: AbortSignal;
}

/** Outcome for one arm in the intention-to-treat (ITT) denominator. */
export type ITTArmStatus = "completed" | "failed" | "timeout" | "missing";

export interface ITTArmResult {
  status: ITTArmStatus;
  /** Binary or bounded metric value. Failed/missing outcomes are imputed as zero. */
  value?: number;
  /** True when at least one pre-registered transport retry was used. */
  retried?: boolean;
}

export interface ITTPair {
  caseId: string;
  baseline: ITTArmResult;
  candidate: ITTArmResult;
}

export interface ITTInput {
  corpusId: string;
  /** Number of planned pairs; this denominator is never reduced by missing rows. */
  planned: number;
  pairs: readonly ITTPair[];
  signal?: AbortSignal;
}

export interface ITTStatisticsResult {
  planned: number;
  attempted: number;
  completed: number;
  scored: number;
  failed: number;
  retried: number;
  /** Primary ITT rates. Every failed, timed-out, or missing arm contributes zero. */
  itt: { baseline: number; candidate: number };
  /** Complete-case calculation, retained for appendix/sensitivity only. */
  completeCase: { baseline: number; candidate: number; pairs: number };
  /** Worst-case sensitivity, where all unobserved outcomes are failures. */
  worstCase: { baseline: number; candidate: number };
}

export interface ClusterStatistics {
  bootstrap(input: BootstrapInput): Promise<ClusterBootstrapResult>;
  mcnemar(input: McNemarInput): Promise<McNemarResult>;
  itt(input: ITTInput): ITTStatisticsResult;
}

export type StatisticsErrorCode =
  | "PCR_STATISTICS_DEPENDENCY_MISSING"
  | "PCR_STATISTICS_INPUT_INVALID"
  | "PCR_STATISTICS_SCOPE_MISMATCH";

export class ClusterStatisticsError extends TypeError {
  readonly code: StatisticsErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StatisticsErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ClusterStatisticsError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const DEFAULT_DRAWS = 10_000;

function failMissing(dependency: string): never {
  throw new ClusterStatisticsError("PCR_STATISTICS_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new ClusterStatisticsError("PCR_STATISTICS_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new ClusterStatisticsError("PCR_STATISTICS_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) failInput(field);
}

function requireSafeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value)) failInput(field);
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

function percentile(values: readonly number[], p: number): number {
  const xs = [...values].sort((left, right) => left - right);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo] ?? 0;
  return (xs[lo] ?? 0) * (hi - pos) + (xs[hi] ?? 0) * (pos - lo);
}

function freezeCatalog(catalog: ClusterCatalog): { corpusId: string; caseToCluster: Map<string, string> } {
  if (!catalog || typeof catalog !== "object") failMissing("catalog");
  requireNonEmpty(catalog.corpusId, "catalog.corpusId");
  if (!catalog.clusters || typeof catalog.clusters !== "object" || Array.isArray(catalog.clusters)) {
    failInput("catalog.clusters");
  }
  const caseToCluster = new Map<string, string>();
  const names = Object.keys(catalog.clusters);
  if (names.length === 0) failInput("catalog.clusters");
  for (const name of names) {
    requireNonEmpty(name, "catalog.clusters");
    const ids = catalog.clusters[name];
    if (!Array.isArray(ids) || ids.length === 0) failInput(`catalog.clusters.${name}`);
    for (const [index, id] of ids.entries()) {
      requireNonEmpty(id, `catalog.clusters.${name}[${index}]`);
      if (caseToCluster.has(id)) failInput(`catalog.clusters.${name}[${index}]`);
      caseToCluster.set(id, name);
    }
  }
  return { corpusId: catalog.corpusId, caseToCluster };
}

export function createClusterStatistics(input: { catalog: ClusterCatalog }): ClusterStatistics {
  if (!input || typeof input !== "object") failMissing("input");
  const catalog = freezeCatalog(input.catalog);
  return {
    async bootstrap(sample: BootstrapInput): Promise<ClusterBootstrapResult> {
      if (!sample || typeof sample !== "object") failInput("sample");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      requireNonEmpty(sample.corpusId, "corpusId");
      if (sample.corpusId !== catalog.corpusId) failScope({ corpusId: sample.corpusId });
      if (!Array.isArray(sample.pairs) || sample.pairs.length === 0) failInput("pairs");
      if (!Number.isSafeInteger(sample.seed)) failInput("seed");
      const draws = sample.draws === undefined ? DEFAULT_DRAWS : sample.draws;
      if (!Number.isSafeInteger(draws) || draws < 1) failInput("draws");
      const seen = new Set<string>();
      const grouped = new Map<string, number[]>();
      for (const [index, row] of sample.pairs.entries()) {
        if (!row || typeof row !== "object") failInput(`pairs[${index}]`);
        requireNonEmpty(row.caseId, `pairs[${index}].caseId`);
        if (seen.has(row.caseId)) failInput(`pairs[${index}].caseId`);
        seen.add(row.caseId);
        const cluster = catalog.caseToCluster.get(row.caseId);
        if (!cluster) failScope({ caseId: row.caseId, corpusId: sample.corpusId });
        requireFinite(row.baseline, `pairs[${index}].baseline`);
        requireFinite(row.candidate, `pairs[${index}].candidate`);
        const bucket = grouped.get(cluster) ?? [];
        bucket.push(row.candidate - row.baseline);
        grouped.set(cluster, bucket);
      }
      const clusterMeans = [...grouped.keys()].sort().map((name) => {
        const deltas = grouped.get(name) ?? [];
        return deltas.reduce((sum, item) => sum + item, 0) / deltas.length;
      });
      const clusters = clusterMeans.length;
      const estimate = clusterMeans.reduce((sum, item) => sum + item, 0) / clusters;
      const rng = mulberry32(sample.seed);
      const boots: number[] = [];
      for (let draw = 0; draw < draws; draw += 1) {
        sample.signal?.throwIfAborted();
        let sum = 0;
        for (let index = 0; index < clusters; index += 1) {
          const pick = Math.floor(rng() * clusters);
          sum += clusterMeans[pick] ?? 0;
        }
        boots.push(sum / clusters);
      }
      return Object.freeze({
        estimate,
        lower: percentile(boots, 0.025),
        upper: percentile(boots, 0.975),
        clusters,
        pairs: sample.pairs.length,
      });
    },
    async mcnemar(sample: McNemarInput): Promise<McNemarResult> {
      if (!sample || typeof sample !== "object") failInput("sample");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      requireNonEmpty(sample.corpusId, "corpusId");
      if (sample.corpusId !== catalog.corpusId) failScope({ corpusId: sample.corpusId });
      if (!Array.isArray(sample.pairs) || sample.pairs.length === 0) failInput("pairs");
      const seen = new Set<string>();
      const clusterNames = new Set<string>();
      let bothPass = 0;
      let baselineOnly = 0;
      let candidateOnly = 0;
      let bothFail = 0;
      for (const [index, row] of sample.pairs.entries()) {
        if (!row || typeof row !== "object") failInput(`pairs[${index}]`);
        requireNonEmpty(row.caseId, `pairs[${index}].caseId`);
        if (seen.has(row.caseId)) failInput(`pairs[${index}].caseId`);
        seen.add(row.caseId);
        const cluster = catalog.caseToCluster.get(row.caseId);
        if (!cluster) failScope({ caseId: row.caseId, corpusId: sample.corpusId });
        clusterNames.add(cluster);
        if (typeof row.baseline !== "boolean") failInput(`pairs[${index}].baseline`);
        if (typeof row.candidate !== "boolean") failInput(`pairs[${index}].candidate`);
        if (row.baseline && row.candidate) bothPass += 1;
        else if (row.baseline) baselineOnly += 1;
        else if (row.candidate) candidateOnly += 1;
        else bothFail += 1;
      }
      return Object.freeze({
        bothPass,
        baselineOnly,
        candidateOnly,
        bothFail,
        discordant: baselineOnly + candidateOnly,
        clusters: clusterNames.size,
        pairs: sample.pairs.length,
      });
    },
    itt(sample: ITTInput): ITTStatisticsResult {
      if (!sample || typeof sample !== "object") failInput("sample");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      requireNonEmpty(sample.corpusId, "corpusId");
      if (sample.corpusId !== catalog.corpusId) failScope({ corpusId: sample.corpusId });
      requireSafeInteger(sample.planned, "planned");
      if (sample.planned < 1) failInput("planned");
      if (!Array.isArray(sample.pairs)) failInput("pairs");
      if (sample.pairs.length > sample.planned) failInput("pairs");

      const seen = new Set<string>();
      let completed = 0;
      let retried = 0;
      let baselineObserved = 0;
      let candidateObserved = 0;
      let completeBaseline = 0;
      let completeCandidate = 0;
      for (const [index, pair] of sample.pairs.entries()) {
        sample.signal?.throwIfAborted();
        if (!pair || typeof pair !== "object") failInput(`pairs[${index}]`);
        requireNonEmpty(pair.caseId, `pairs[${index}].caseId`);
        if (seen.has(pair.caseId)) failInput(`pairs[${index}].caseId`);
        seen.add(pair.caseId);
        const cluster = catalog.caseToCluster.get(pair.caseId);
        if (!cluster) failScope({ caseId: pair.caseId, corpusId: sample.corpusId });
        const baseline = validateITTArm(pair.baseline, `pairs[${index}].baseline`);
        const candidate = validateITTArm(pair.candidate, `pairs[${index}].candidate`);
        if (baseline.retried || candidate.retried) retried += 1;
        if (baseline.status === "completed" && candidate.status !== "missing") baselineObserved += baseline.value ?? 0;
        if (candidate.status === "completed" && baseline.status !== "missing") candidateObserved += candidate.value ?? 0;
        if (baseline.status === "completed" && candidate.status === "completed") {
          completed += 1;
          completeBaseline += baseline.value ?? 0;
          completeCandidate += candidate.value ?? 0;
        }
      }
      const scored = completed;
      const failed = sample.planned - completed;
      const completeCase = {
        baseline: completed === 0 ? 0 : completeBaseline / completed,
        candidate: completed === 0 ? 0 : completeCandidate / completed,
        pairs: completed,
      };
      return Object.freeze({
        planned: sample.planned,
        attempted: sample.pairs.length,
        completed,
        scored,
        failed,
        retried,
        itt: {
          baseline: baselineObserved / sample.planned,
          candidate: candidateObserved / sample.planned,
        },
        completeCase,
        worstCase: {
          baseline: baselineObserved / sample.planned,
          candidate: candidateObserved / sample.planned,
        },
      });
    },
  };
}

function validateITTArm(value: unknown, field: string): ITTArmResult {
  if (!value || typeof value !== "object") failInput(field);
  const arm = value as Partial<ITTArmResult>;
  if (arm.status !== "completed" && arm.status !== "failed" && arm.status !== "timeout" && arm.status !== "missing") {
    failInput(`${field}.status`);
  }
  if (arm.retried !== undefined && typeof arm.retried !== "boolean") failInput(`${field}.retried`);
  if (arm.status === "completed") {
    requireFinite(arm.value, `${field}.value`);
  } else if (arm.value !== undefined && (typeof arm.value !== "number" || !Number.isFinite(arm.value))) {
    failInput(`${field}.value`);
  }
  return {
    status: arm.status,
    value: arm.status === "completed" ? arm.value : undefined,
    retried: arm.retried === true,
  };
}
