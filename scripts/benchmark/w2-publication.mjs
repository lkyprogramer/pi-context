#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const unrun = join(root, "artifacts/runs/w2-v3-live/UNRUN.md");
const manifestPath = join(root, "artifacts/runs/w2-v3-live/run-manifest.json");
if (existsSync(unrun) || !existsSync(manifestPath)) {
  process.stderr.write("PCR_PUBLICATION_RUN_MISSING\n");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.status === "unrun" || manifest.publicationClaim === true || (manifest.completedPairs ?? 0) < 300) {
  process.stderr.write("PCR_PUBLICATION_RUN_MISSING\n");
  process.exit(1);
}
process.stdout.write("ok\n");
