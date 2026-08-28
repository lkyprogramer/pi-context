import { runPairedContinuation, type ContinuationCut } from "./paired-continuation.js";
import { defaultScenarios, type BenchmarkArm, type BenchmarkScenario } from "./scenarios.js";
import {
  bootstrapMean,
  scoreAbstention,
  scoreAndBootstrap,
  scoreConstraintRecall,
  scorePolarity,
  scoreTime,
  scoreUpdate,
  type ArmScore,
  type BenchmarkReport,
} from "./scoring.js";

export interface BenchmarkConfig {
  seed: number;
  scenarios?: BenchmarkScenario[];
  arms: BenchmarkArm[];
}

export function defaultBenchmarkConfig(seed = 42): BenchmarkConfig {
  return {
    seed,
    scenarios: defaultScenarios(),
    arms: ["pi-native", "pcr-deterministic", "pcr-semantic", "billion-context"],
  };
}

export async function runScenarioArm(scenario: BenchmarkScenario, arm: BenchmarkArm, seed: number): Promise<ArmScore> {
  const cut: ContinuationCut = {
    scenarioId: scenario.id,
    firstKeptEntryId: `cut_${scenario.id}`,
    budgetTokens: scenario.tokensBefore,
    seed,
  };
  const continuation = runPairedContinuation(scenario, arm, cut);
  const visible = continuation.visible;
  return {
    arm,
    scenarioId: scenario.id,
    seed,
    constraintRecall: scoreConstraintRecall({ expected: scenario.expectedConstraint, observed: visible }),
    polarity: scorePolarity(scenario.expectedConstraint, visible),
    time: scenario.expectedTime ? scoreTime(scenario.expectedTime, visible) : 1,
    update: scenario.previousFact ? scoreUpdate(scenario.previousFact, visible) : 1,
    abstention: scenario.family === "abstention" ? scoreAbstention(visible) : 1,
    closedLoop: /did not deploy/.test(visible) ? 1 : 0,
    secretLeak: /sk-t42|sk-live/.test(visible) ? 1 : 0,
    tokensAfter: continuation.tokensAfter,
    tokensBefore: continuation.tokensBefore,
    compacted: continuation.compacted && continuation.sameCut && continuation.sameBudget,
    isolatedProcess: continuation.isolatedProcess,
    attribution: {
      compressor: continuation.compacted ? 1 : 0,
      retrieval: 1,
      reader: scoreConstraintRecall({ expected: scenario.expectedConstraint, observed: visible }),
      executor: /did not deploy/.test(visible) ? 1 : 0,
    },
  };
}

export async function runBenchmarkSuite(config: BenchmarkConfig): Promise<BenchmarkReport> {
  const scenarios = config.scenarios ?? defaultScenarios();
  const paired = await Promise.all(
    scenarios.flatMap((scenario) => config.arms.map((arm) => runScenarioArm(scenario, arm, config.seed))),
  );
  const scored = scoreAndBootstrap(paired, {
    confidence: 0.95,
    paired: true,
    attribution: ["compressor", "retrieval", "reader", "executor"],
  });
  return {
    ...scored,
    publicationClaim: false,
    officialControl: "pi-native",
    seed: config.seed,
    generatedAt: new Date().toISOString(),
  };
}

export { bootstrapMean };
