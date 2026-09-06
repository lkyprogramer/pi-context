#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { preflightIsolation } from "./credential-broker.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/benchmark/src/small-runner.ts");
const jiti = join(root, "node_modules/.bin/jiti");
if (!existsSync(jiti)) {
  process.stderr.write("PCR_SMALL_RUNNER_DEPENDENCY_MISSING\n");
  process.exit(1);
}
const isolation = preflightIsolation(process.env);
const env = {
  ...process.env,
  PCR_TOOLS_ENABLED_ALLOWED: isolation.toolsEnabledAllowed ? "1" : "0",
  PCR_ISOLATION_PROVEN: isolation.proven ? "1" : "0",
  PCR_ISOLATION_REASON: isolation.reason,
};
const result = spawnSync(jiti, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
  env,
});
process.exit(result.status ?? 1);
