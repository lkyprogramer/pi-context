#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "scripts/gates/deterministic-v3.ts");
const jiti = join(root, "node_modules/.bin/jiti");
if (!existsSync(jiti)) {
  process.stderr.write("PCR_GATE_DEPENDENCY_MISSING\n");
  process.exit(1);
}
const result = spawnSync(jiti, [cli, ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
