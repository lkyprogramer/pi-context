#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vitest = join(root, "node_modules/.bin/vitest");
const result = spawnSync(vitest, ["run", "--workspace", "vitest.live-paired-w2.workspace.ts"], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(result.status ?? 1);
