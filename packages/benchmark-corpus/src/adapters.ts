import { generateScenario, w1FamilyPlan, type GeneratedScenario } from "./generator.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CorpusAccess {
  readonly role: "developer" | "gate-worker";
}

export interface BenchmarkCorpus {
  readonly version: string;
  readonly publicCount: number;
  readonly sealedCount: number;
  readonly corpusClass: "synthetic-public";
  readonly scenarios: readonly GeneratedScenario[];
}

export function loadSpecTemplates() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/pi-context-compression-benchmark-spec/corpus/templates");
  return readdirSync(root)
    .filter((name) => name.endsWith(".scenario.json"))
    .map((name) => {
      const obj = JSON.parse(readFileSync(join(root, name), "utf8")) as { scenarioId: string; family: string };
      return { scenarioId: obj.scenarioId, family: obj.family };
    });
}

export async function loadBenchmarkCorpus(_manifestPath?: string, access: CorpusAccess = { role: "developer" }): Promise<BenchmarkCorpus> {
  const templates = loadSpecTemplates();
  const generated: GeneratedScenario[] = [];
  for (const [index, scenario] of w1FamilyPlan().entries()) {
    generated.push(await generateScenario(scenario, 20260827 + index, `/tmp/pcr-corpus/${scenario.scenarioId}`));
  }
  const scenarios = generated.map((scenario) => {
    if (access.role === "developer") {
      const { hiddenTask: _hidden, ...publicScenario } = scenario;
      return publicScenario;
    }
    return scenario;
  });
  return {
    version: "1.0.0",
    publicCount: templates.length,
    sealedCount: 0,
    corpusClass: "synthetic-public",
    scenarios,
  };
}

export { generateScenario, w1FamilyPlan };
