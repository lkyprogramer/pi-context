#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const jiti = join(root, "node_modules/.bin/jiti");
const cli = join(root, "packages/benchmark/src/corpus/cli.ts");
const corpus = join(root, "benchmarks/corpus-v3");
if (!existsSync(jiti)) {
  process.stderr.write("PCR_CORPUS_DEPENDENCY_MISSING\n");
  process.exit(1);
}
const forwarded = process.argv.slice(2);
const args = forwarded.length > 0
  ? forwarded
  : ["--verify", "--a1", "--root", corpus, "--corpus-id", "pcr-corpus-v3", "--major", "1"];
if (!args.includes("--a1")) args.unshift("--a1");
if (!args.includes("--root")) args.push("--root", corpus);
if (!args.includes("--corpus-id")) args.push("--corpus-id", "pcr-corpus-v3");
if (!args.includes("--major")) args.push("--major", "1");
const result = spawnSync(jiti, [cli, ...args], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
