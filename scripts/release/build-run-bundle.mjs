#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(process.cwd());
const source = join(root, "artifacts/runs");
const out = join(root, "artifacts/runs/rc");
const staging = mkdtempSync(join(tmpdir(), "pcr-rc-staging-"));
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
const SECRET = /(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}|sk-(?:live|t\d+|ff)(?:-[A-Za-z0-9_-]+)?|Bearer\s+[A-Za-z0-9._-]{20,})/giu;
const entries = files.sort().map((path) => {
  const original = readFileSync(path, "utf8");
  const text = original.replace(SECRET, "[redacted]");
  SECRET.lastIndex = 0;
  const rel = relative(root, path);
  const staged = join(staging, rel);
  mkdirSync(join(staging, relative(root, path).split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(staged, text);
  const bytes = Buffer.from(text, "utf8");
  return { path: rel, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), redacted: text !== original };
});
const scan = spawnSync(process.execPath, [join(root, "scripts/release/secret-scan.mjs"), staging], { encoding: "utf8" });
if (scan.status !== 0) throw new Error("PCR_RC_SECRET_SCAN_FAILED");
const scanReport = JSON.parse(scan.stdout);
delete scanReport.root;
const archive = join(out, "raw-bundle.tar.gz");
const packed = spawnSync("tar", ["-czf", archive, "-C", staging, "."], { encoding: "utf8" });
if (packed.status !== 0) throw new Error(packed.stderr || "PCR_RC_ARCHIVE_FAILED");
const manifest = { format: "pcr-rc-bundle-v1", commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), files: entries, secretScan: scanReport };
manifest.digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifest: join(out, "manifest.json"), archive, digest: manifest.digest, files: entries.length }, null, 2));
