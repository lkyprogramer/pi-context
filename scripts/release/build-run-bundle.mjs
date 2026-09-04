#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const source = join(root, "artifacts/runs");
const out = join(root, "artifacts/runs/rc");
mkdirSync(out, { recursive: true });
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "rc") continue;
    if (name === "pairs" || name === "session.jsonl" || name === "raw.json") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(json|md|txt)$/u.test(name) && statSync(path).size <= 8 * 1024 * 1024) files.push(path);
  }
}
walk(source);
const entries = files.sort().map((path) => {
  const bytes = readFileSync(path);
  return { path: relative(root, path), bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const manifest = { format: "pcr-rc-bundle-v1", commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), files: entries };
manifest.digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const scan = spawnSync(process.execPath, [join(root, "scripts/release/secret-scan.mjs"), out], { encoding: "utf8" });
if (scan.status !== 0) throw new Error("PCR_RC_SECRET_SCAN_FAILED");
console.log(JSON.stringify({ manifest: join(out, "manifest.json"), digest: manifest.digest, files: entries.length }, null, 2));
