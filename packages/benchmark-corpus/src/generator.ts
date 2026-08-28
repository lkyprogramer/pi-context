import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GeneratedScenario {
  readonly scenarioId: string;
  readonly family: string;
}

export function generateScenario(family: string, index: number): GeneratedScenario {
  return { scenarioId: `${family}-${String(index).padStart(3, "0")}`, family };
}

export function loadSpecTemplates(): GeneratedScenario[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/pi-context-compression-benchmark-spec/corpus/templates");
  return readdirSync(root)
    .filter((name) => name.endsWith(".scenario.json"))
    .map((name) => {
      const obj = JSON.parse(readFileSync(join(root, name), "utf8")) as { scenarioId: string; family: string };
      return { scenarioId: obj.scenarioId, family: obj.family };
    });
}
