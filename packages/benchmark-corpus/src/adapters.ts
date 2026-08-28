import { generateScenario, loadSpecTemplates, type GeneratedScenario } from "./generator.js";

export interface CorpusManifest {
  readonly version: string;
  readonly publicCount: number;
  readonly sealedCount: number;
  readonly scenarios: readonly GeneratedScenario[];
}

export function loadBenchmarkCorpus(): CorpusManifest {
  const templates = loadSpecTemplates();
  const synthetic = ["tool-heavy", "delayed-constraint", "recall-needed", "recall-not-needed"].flatMap((family, familyIndex) =>
    Array.from({ length: 15 }, (_, i) => generateScenario(family, familyIndex * 15 + i + 1)),
  );
  return {
    version: "1.0.0",
    publicCount: templates.length,
    sealedCount: 0,
    scenarios: [...templates, ...synthetic],
  };
}
