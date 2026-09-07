import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { pathToFileURL } from "node:url";

import {
  buildRecursiveLaneHistory,
  evaluateW5Gate,
  runBoundaryReplay,
  runFaultSecurity,
  runNaturalThreshold,
  runOverflowProgress,
  runPerformanceCache,
  runRecursivePins,
} from "../../packages/benchmark/src/lanes/w5.ts";
import { createRuntimeCursor } from "../../packages/core/src/identity/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function headCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.stdout.trim();
}

export async function runDeterministicV3(commit = headCommit()) {
  const corpusRoot = join(root, "benchmarks/corpus-v2");
  const boundary = await runBoundaryReplay({ corpusRoot, seeds: [0, 1, 2] });
  const natural = await runNaturalThreshold({ tokensBefore: 190_000, compactReason: "threshold", triggered: true });
  const overflow = await runOverflowProgress({
    prompt: "overflow-retry ".repeat(2_000),
    windowTokens: 400,
  });
  const cursor = createRuntimeCursor({
    workspacePath: join(root, "benchmarks/corpus-v2"),
    sessionId: "w5",
    leafId: "leaf",
    lineageEntryIds: ["root", "leaf"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const recursive = runRecursivePins(buildRecursiveLaneHistory(cursor));
  const fault = runFaultSecurity({
    platform: process.platform === "darwin" ? "darwin" : "linux",
    fuzzSeeds: [1, 2, 3],
    leaks: ["sk-live"],
    surfaces: ["ok"],
    crashReplay: 1,
  });
  const performance = runPerformanceCache({
    coldTokens: 900,
    warmTokens: 140,
    english: "hello world",
    cjk: "你好世界",
    toolsJson: readFileSync(join(root, "benchmarks/corpus-v2/cases.json"), "utf8").slice(0, 200),
  });
  writeJson(join(root, "artifacts/runs/w2-v3/boundary/report.json"), boundary);
  writeJson(join(root, "artifacts/runs/w2-v3/natural-threshold/report.json"), natural);
  writeJson(join(root, "artifacts/runs/w2-v3/overflow/report.json"), overflow);
  writeJson(join(root, "artifacts/runs/w2-v3/recursive/report.json"), recursive);
  writeJson(join(root, "artifacts/runs/fault-security/report.json"), fault);
  writeJson(join(root, "artifacts/runs/performance-cache/report.json"), performance);
  const gate = evaluateW5Gate({
    commit,
    headCommit: commit,
    lanes: ["boundary", "natural-threshold", "overflow", "recursive", "fault-security", "performance-cache"],
    bundles: {
      boundary,
      "natural-threshold": natural,
      overflow,
      recursive,
      "fault-security": fault,
      "performance-cache": performance,
    },
  });
  const decision = {
    ...gate,
    liveProvider: false,
    commit,
    boundHashes: {
      boundary: boundary.pairs,
      overflow: overflow.ok,
      fault: fault.critical,
    },
  };
  writeJson(join(root, "artifacts/gates/deterministic-v3/gate-decision.json"), decision);
  return decision;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const decision = await runDeterministicV3();
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}
