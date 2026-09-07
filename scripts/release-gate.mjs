#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const evIdx = args.indexOf("--evidence");
const evidenceDir = evIdx >= 0 ? args[evIdx + 1] : join(repo, "artifacts/release-candidate");
mkdirSync(evidenceDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
if (pkg.private !== true) {
  console.error("private:true required");
  process.exit(1);
}

const measured = join(repo, "artifacts/v5-tasks/g0-g5-table.json");
if (!existsSync(measured)) {
  console.error("measured G0-G5 table missing; refuse to invent pass rows");
  process.exit(1);
}
const table = JSON.parse(readFileSync(measured, "utf8"));
writeFileSync(join(evidenceDir, "g0-g5-table.json"), `${JSON.stringify(table, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, private: pkg.private, source: "artifacts/v5-tasks/g0-g5-table.json", recommendation: table.recommendation ?? null }, null, 2));
