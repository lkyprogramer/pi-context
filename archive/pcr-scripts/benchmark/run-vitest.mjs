#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("usage: run-vitest <test-file...>\n");
  process.exit(1);
}
const result = spawnSync("pnpm", ["vitest", "run", ...files, "--config", "vitest.unit.config.ts"], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
