import { defineBenchmarkContracts, type BenchmarkReport } from "../../benchmark-contracts/src/index.js";
import { evaluateBenchmarkGate, type GateEvaluationInput } from "./gates.js";

export interface ReportBuildInput extends GateEvaluationInput {
  candidateArms?: readonly string[];
}

export function buildBenchmarkReport(input: ReportBuildInput): BenchmarkReport {
  const decision = evaluateBenchmarkGate(input);
  return defineBenchmarkContracts().parseBenchmarkReport({
    runId: input.runId ?? "run-gate",
    stage: "w1",
    baselineArm: "A0",
    candidateArms: [...(input.candidateArms ?? ["A1", "A2"])],
    hardGatePass: decision.hardGatePass,
    qualityCiLower: input.qualityCiLower,
    qualityMargin: input.qualityMargin,
    medianTokenDelta: input.ingressTokenMedianDelta,
    realizedNetMedian: input.realizedNetMedian,
    failures: decision.decision === "proceed-to-w2" ? [] : [{ reason: decision.reasons[0] }],
    artifactHashes: ["1".repeat(64), "2".repeat(64)],
  });
}

export function renderReportMarkdown(report: BenchmarkReport): string {
  return `# Benchmark Report ${report.runId}\n\nhardGatePass=${report.hardGatePass}\nmedianTokenDelta=${report.medianTokenDelta}\n`;
}

export { evaluateBenchmarkGate };
