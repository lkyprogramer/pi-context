#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(root, "packages/benchmark/src/corpus/cli.ts");
const jiti = join(root, "node_modules/.bin/jiti");
if (!existsSync(jiti)) {
  process.stderr.write("PCR_CORPUS_DEPENDENCY_MISSING\n");
  process.exit(1);
}
const args = process.argv.slice(2);
const forwarded = args.length > 0
  ? args
  : ["--verify", "--root", join(root, "benchmarks/corpus-v2"), "--corpus-id", "pcr-corpus-v2", "--major", "1"];
const result = spawnSync(jiti, [cli, ...forwarded], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
