#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, env: process.env });
  return result.status ?? 1;
}

const isolate = run("pnpm", [
  "vitest",
  "run",
  "packages/benchmark/test/arm-isolate.test.ts",
  "--config",
  "vitest.unit.config.ts",
]);
if (isolate !== 0) process.exit(isolate);

const extension = join(root, "apps/pi-context-runtime/dist/extension.js");
const models = join(homedir(), ".pi/agent/models.json");
if (!existsSync(extension) || !existsSync(models)) {
  process.stderr.write("PCR_LIVE_PROVIDER_UNAVAILABLE\n");
  process.exit(1);
}

const live = spawnSync("pnpm", ["exec", "vitest", "run", "--workspace", "vitest.live-paired-w2.workspace.ts"], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, PCR_W2_LIVE_PROFILE: process.env.PCR_W2_LIVE_PROFILE || "one" },
});
process.exit(live.status ?? 1);
