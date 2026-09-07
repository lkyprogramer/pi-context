#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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
    const path = join(dir, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) throw new Error(`PCR_RC_SYMLINK_FORBIDDEN:${relative(root, path)}`);
    if (entry.isDirectory()) walk(path);
    else if (/\.(json|jsonl|md|txt)$/u.test(name) && entry.size <= 8 * 1024 * 1024) files.push(path);
  }
}
walk(source);
function freezeDirectories(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) freezeDirectories(path);
  }
  utimesSync(dir, 0, 0);
}
const SECRET = /(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{8,}|sk-(?:live|t\d+|ff)(?:-[A-Za-z0-9_-]+)?|Bearer\s+[A-Za-z0-9._-]{20,})/giu;
const PII = [/(?:[A-Za-z]:\\|\/)(?:Users|home|var|private|tmp|opt|workspace)[^\s"']*/gu, /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu];
const SENSITIVE_PREVIEW = /("(?:summaryPreview|probePreview|prompt|toolResult)"\s*:\s*)"(?:\\.|[^"\\])*"/gu;
function redactJsonl(text) {
  return text.split("\n").map((line) => {
    if (!line.trim()) return line;
    try {
      const value = JSON.parse(line);
      const visit = (node) => {
        if (Array.isArray(node)) return node.map(visit);
        if (!node || typeof node !== "object") return node;
        const result = {};
        for (const [key, child] of Object.entries(node)) {
          if (key === "content" && typeof child === "string") {
            result[key] = "[redacted]";
          } else if (key === "content" && Array.isArray(child)) {
            result[key] = child.map((part) => {
              if (!part || typeof part !== "object") return { type: typeof part };
              return { type: part.type ?? "text", ...("text" in part ? { text: "[redacted]" } : {}) };
            });
          } else result[key] = visit(child);
        }
        return result;
      };
      return JSON.stringify(visit(value));
    } catch {
      return line.replace(SENSITIVE_PREVIEW, '$1"[redacted]"');
    }
  }).join("\n");
}
const entries = files.sort().map((path) => {
  const original = readFileSync(path, "utf8");
  let text = original.replace(SECRET, "[redacted]");
  for (const pattern of PII) text = text.replace(pattern, "[redacted]");
  text = text.replace(SENSITIVE_PREVIEW, '$1"[redacted]"');
  if (path.endsWith(".jsonl")) text = redactJsonl(text);
  SECRET.lastIndex = 0;
  const rel = relative(root, path);
  const staged = join(staging, rel);
  mkdirSync(join(staging, relative(root, path).split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(staged, text);
  utimesSync(staged, 0, 0);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`PCR_RC_REDACTED_FILE_TOO_LARGE:${rel}`);
  return { path: rel, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), redacted: text !== original };
});
const scan = spawnSync(process.execPath, [join(root, "scripts/release/secret-scan.mjs"), staging], { encoding: "utf8" });
if (scan.status !== 0) throw new Error("PCR_RC_SECRET_SCAN_FAILED");
const scanReport = JSON.parse(scan.stdout);
delete scanReport.root;
const archive = join(out, "raw-bundle.tar.gz");
freezeDirectories(staging);
const tarPath = `${archive}.${process.pid}.${Date.now()}.tmp`;
const packed = spawnSync("tar", ["--format=ustar", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root", "--no-xattrs", "--no-acls", "-cf", tarPath, "-C", staging, ...entries.map(({ path }) => path)], { encoding: "utf8", env: { ...process.env, TZ: "UTC" } });
if (packed.status !== 0) throw new Error(packed.stderr || "PCR_RC_ARCHIVE_FAILED");
const gzipped = spawnSync("gzip", ["-n", "-c", tarPath], { encoding: null, maxBuffer: 256 * 1024 * 1024 });
if (gzipped.status !== 0 || !gzipped.stdout) throw new Error(gzipped.stderr?.toString() || "PCR_RC_GZIP_FAILED");
writeFileSync(archive, gzipped.stdout);
unlinkSync(tarPath);
const archiveBytes = readFileSync(archive);
const manifest = { format: "pcr-rc-bundle-v1", commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), files: entries, archive: { bytes: archiveBytes.byteLength, sha256: createHash("sha256").update(archiveBytes).digest("hex") }, secretScan: scanReport };
manifest.digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifest: join(out, "manifest.json"), archive, digest: manifest.digest, files: entries.length }, null, 2));
