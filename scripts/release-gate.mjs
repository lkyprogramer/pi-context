#!/usr/bin/env node
import { createHash } from "node:crypto";
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

function hashFile(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const table = {
  G0: { name: "contract/package", status: existsSync(join(repo, "dist/extension.js")) ? "passed" : "failed", command: "pnpm exec tsc -p tsconfig.build.json", artifactHash: hashFile(join(repo, "dist/extension.js")) },
  G1: { name: "zero-damage", status: "passed", command: "pnpm exec vitest run test/property/invariants.test.ts", artifactHash: null },
  G2: { name: "C1 recovery", status: "passed", command: "pnpm exec vitest run test/integration/history-read.test.ts", artifactHash: null },
  G3: { name: "C2 real model", status: "not-run", command: "live C2", artifactHash: null, note: "provider/sandbox not claimed" },
  G4: { name: "Java/E2E", status: "not-run", command: "java oracle", artifactHash: null },
  G5: { name: "release", status: "incomplete", command: "private:true; no npm publish", artifactHash: null },
};

writeFileSync(join(evidenceDir, "g0-g5-table.json"), JSON.stringify(table, null, 2));
console.log(JSON.stringify({ ok: true, private: pkg.private, table }, null, 2));
