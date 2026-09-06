import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import {
  evaluateScenarioAssertions,
  independentClusterCount,
  loadSmallCorpus,
  validateScenario,
  type Scenario,
} from "../src/small-runner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CASES = join(ROOT, "experiments/cases");

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function materialize(scenario: Scenario, mutate?: (files: Record<string, string>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), `pcr-case-${scenario.id}-`));
  const files = { ...scenario.workspaceFiles };
  mutate?.(files);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

it("rejects observed-state tasks without a real workspace", () => {
  const text = "A previous test process observed version=7.";
  const input = {
    id: "x",
    clusterId: "c",
    provenance: "synthetic",
    mode: "coding",
    prompt: "Verify the current version from version.txt.",
    sourceEntries: [{ id: "e1", role: "tool", text }],
    oracle: {
      kind: "observed-state",
      expected: "7",
      sourceEntryId: "e1",
      sourceSha256: sha(text),
    },
    workspaceFiles: {},
    assertions: [{ kind: "file-equals", path: "version.txt", expected: "7\n" }],
  };
  expect(() => validateScenario(input)).toThrow("PCR_SCENARIO_STATE_UNWITNESSED");
  expect(() => validateScenario({ ...input, workspaceFiles: { "version.txt": "7\n" } })).not.toThrow();
});

it("rejects a requested-target labeled as already deployed", () => {
  const text = "改为 version 7；还没有执行修改。";
  expect(() => validateScenario({
    id: "deployed",
    clusterId: "c",
    provenance: "synthetic",
    mode: "reader",
    prompt: "现在是否已部署？",
    sourceEntries: [{ id: "u1", role: "user", text }],
    oracle: { kind: "requested-target", expected: "已部署", sourceEntryId: "u1", sourceSha256: sha(text) },
    workspaceFiles: {},
    assertions: [],
  })).toThrow("PCR_SCENARIO_TARGET_DEPLOYED");
});

it("loads twelve independent synthetic tasks without inflating duplicate clusters", () => {
  const corpus = loadSmallCorpus(CASES);
  expect(corpus.scenarios).toHaveLength(12);
  expect(corpus.independentClusters).toBe(12);
  expect(corpus.scenarios.every((row) => row.provenance === "synthetic")).toBe(true);
  expect(independentClusterCount([
    { clusterId: "coding-api-repair" },
    { clusterId: "coding-api-repair" },
  ])).toBe(1);
});

it("fails coding assertions against the broken fixture and passes after a real file repair", () => {
  const corpus = loadSmallCorpus(CASES);
  const scenario = corpus.scenarios.find((row) => row.id === "public-api-repair");
  if (!scenario) throw new Error("missing public-api-repair");
  const broken = evaluateScenarioAssertions({ workspaceDir: materialize(scenario), scenario });
  expect(broken.ok).toBe(false);
  expect(broken.failures.some((row) => row.startsWith("command-exit"))).toBe(true);
  const repaired = evaluateScenarioAssertions({
    workspaceDir: materialize(scenario, (files) => {
      files["sum.js"] = "export function sum(a,b) { return a + b; }\n";
    }),
    scenario,
  });
  expect(repaired.ok).toBe(true);
});

it("does not treat an assistant claim as coding success", () => {
  const corpus = loadSmallCorpus(CASES);
  const scenario = corpus.scenarios.find((row) => row.id === "public-api-repair");
  if (!scenario) throw new Error("missing public-api-repair");
  const claimed = {
    ...scenario,
    sourceEntries: [
      ...scenario.sourceEntries,
      { id: "a1", role: "assistant" as const, text: "done, sum now returns 5" },
    ],
  };
  const result = evaluateScenarioAssertions({ workspaceDir: materialize(scenario), scenario: claimed });
  expect(result.ok).toBe(false);
});
