export interface ConstraintObservation {
  expected: string;
  observed: string;
}

export interface ArmScore {
  arm: string;
  scenarioId: string;
  seed: number;
  constraintRecall: number;
  polarity: number;
  time: number;
  update: number;
  abstention: number;
  closedLoop: number;
  secretLeak: number;
  tokensAfter: number;
  tokensBefore: number;
  compacted: boolean;
  isolatedProcess: boolean;
  attribution: {
    compressor: number;
    retrieval: number;
    reader: number;
    executor: number;
  };
}

export interface BootstrapInterval {
  lower: number;
  upper: number;
  mean: number;
  confidence: number;
}

export interface BenchmarkReport {
  publicationClaim: false;
  officialControl: "pi-native";
  seed: number;
  scores: ArmScore[];
  pairedDeltas: Array<{ scenarioId: string; metric: string; delta: number }>;
  bootstrap: Record<string, BootstrapInterval>;
  killCriteria: { efficiencyNonInferior: boolean; qualityNonInferior: boolean };
  generatedAt: string;
}

export function scoreConstraintRecall(input: ConstraintObservation): number {
  const expected = input.expected.toLowerCase();
  const observed = input.observed.toLowerCase();
  const forbidsDeploy = /must-not deploy|do not deploy|never deploy/.test(expected);
  if (!forbidsDeploy) {
    if (!observed.trim()) return 0;
    return observed.includes(expected) ? 1 : 0;
  }
  const contradicted = /\bdeployed\b/.test(observed) && !/did not deploy|do not deploy|should not deploy/.test(observed);
  if (contradicted) return 0;
  const honored = /did not deploy|do not deploy|should not deploy|must not deploy|abstain/.test(observed);
  return honored ? 1 : 0;
}

export function scorePolarity(expected: string, observed: string): number {
  if (/must-not|do not/.test(expected.toLowerCase())) {
    return /not |never |abstain|must not/.test(observed.toLowerCase()) ? 1 : 0;
  }
  return observed.toLowerCase().includes(expected.toLowerCase()) ? 1 : 0;
}

export function scoreTime(expectedIso: string, observed: string): number {
  return observed.includes(expectedIso) ? 1 : 0;
}

export function scoreUpdate(previous: string, observed: string): number {
  return observed.includes(previous) && /updated|now|instead/.test(observed.toLowerCase()) ? 1 : 0;
}

export function scoreAbstention(observed: string): number {
  return /cannot determine|unknown|abstain|not enough/.test(observed.toLowerCase()) ? 1 : 0;
}

export function bootstrapMean(samples: number[], confidence = 0.95, draws = 200): BootstrapInterval {
  if (samples.length === 0) return { lower: 0, upper: 0, mean: 0, confidence };
  const means: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    let sum = 0;
    for (let j = 0; j < samples.length; j += 1) {
      sum += samples[Math.floor(Math.random() * samples.length)] ?? 0;
    }
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);
  const mean = samples.reduce((sum, item) => sum + item, 0) / samples.length;
  const alpha = (1 - confidence) / 2;
  return {
    mean,
    confidence,
    lower: means[Math.floor(alpha * means.length)] ?? mean,
    upper: means[Math.min(means.length - 1, Math.floor((1 - alpha) * means.length))] ?? mean,
  };
}

export function scoreAndBootstrap(
  paired: ArmScore[],
  opts: { confidence: number; paired: boolean; attribution: Array<keyof ArmScore["attribution"]> },
): Pick<BenchmarkReport, "scores" | "pairedDeltas" | "bootstrap" | "killCriteria" | "publicationClaim" | "officialControl"> {
  const natives = paired.filter((item) => item.arm === "pi-native");
  const pcrs = paired.filter((item) => item.arm === "pcr-deterministic");
  const deltas: BenchmarkReport["pairedDeltas"] = [];
  for (const native of natives) {
    const match = pcrs.find((item) => item.scenarioId === native.scenarioId && item.seed === native.seed);
    if (!match) continue;
    deltas.push({ scenarioId: native.scenarioId, metric: "constraintRecall", delta: match.constraintRecall - native.constraintRecall });
    deltas.push({ scenarioId: native.scenarioId, metric: "tokensAfter", delta: native.tokensAfter - match.tokensAfter });
  }
  const quality = bootstrapMean(deltas.filter((item) => item.metric === "constraintRecall").map((item) => item.delta), opts.confidence);
  const efficiency = bootstrapMean(deltas.filter((item) => item.metric === "tokensAfter").map((item) => item.delta), opts.confidence);
  const bothCompacted = paired.filter((item) => item.arm === "pi-native" || item.arm === "pcr-deterministic").every((item) => item.compacted);
  return {
    publicationClaim: false,
    officialControl: "pi-native",
    scores: paired,
    pairedDeltas: deltas,
    bootstrap: { qualityDelta: quality, tokenSavings: efficiency },
    killCriteria: {
      qualityNonInferior: quality.lower >= -0.05,
      efficiencyNonInferior: bothCompacted && efficiency.lower >= 0,
    },
  };
}
