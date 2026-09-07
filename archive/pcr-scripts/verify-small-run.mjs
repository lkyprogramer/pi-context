#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/benchmark/src/small-runner.ts");
const jiti = join(root, "node_modules/.bin/jiti");
if (!existsSync(jiti)) {
  process.stderr.write("PCR_SMALL_RUNNER_DEPENDENCY_MISSING\n");
  process.exit(1);
}
const dir = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "artifacts/lean-v4";
const result = spawnSync(jiti, [cli, "--verify", dir], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
