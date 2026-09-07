#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  test: {
    include: ["tests/performance/**/*.bench.ts"],
    fileParallelism: false,
    testTimeout: 5 * 60_000,
  },
};

function isCli() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isCli()) {
  const vitest = join(root, "node_modules/.bin/vitest");
  const result = spawnSync(
    vitest,
    ["run", "--config", fileURLToPath(import.meta.url), "tests/performance"],
    { cwd: root, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  const { runCliSpikes } = await import("../tests/performance/support.ts");
  const report = await runCliSpikes();
  mkdirSync(join(root, "reports/performance"), { recursive: true });
  const out = join(root, "reports/performance/latest.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
