import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { sha256Canonical } from "../../benchmark-contracts/src/index.js";

export interface ArchiveEntry {
  readonly path: string;
  readonly sha256: string;
  readonly mode: number;
  readonly size: number;
  readonly symlink?: string;
}

export interface LogicalArchive {
  readonly entries: readonly ArchiveEntry[];
  readonly sha256: string;
}

const SKIP_CREDENTIAL_NAMES = new Set([".env", "credentials.json", "credentials", ".npmrc"]);

function sha256Bytes(buf: Uint8Array | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function posixPath(rel: string): string {
  return rel.split(sep).join("/");
}

function isCredential(rel: string): boolean {
  const base = rel.split(/[\\/]/).pop() ?? rel;
  if (SKIP_CREDENTIAL_NAMES.has(base) || base.startsWith(".env.")) return true;
  return /secret|credential|token|private[_-]?key/i.test(base);
}

export function assertInsideRoot(root: string, candidate: string): void {
  const rootReal = realpathSync(root);
  let candidateAbs = resolve(candidate);
  try {
    candidateAbs = realpathSync(candidate);
  } catch {
    const fromRoot = relative(root, candidateAbs);
    candidateAbs = resolve(rootReal, fromRoot);
  }
  const rel = relative(rootReal, candidateAbs);
  if (rel === "..") {
    throw new Error(`symlink escape: ${candidate}`);
  }
  if (rel.split(sep)[0] === "..") {
    throw new Error(`symlink escape: ${candidate}`);
  }
}

export async function buildLogicalArchive(root: string, blobsDir: string): Promise<LogicalArchive> {
  mkdirSync(blobsDir, { recursive: true });
  const entries: ArchiveEntry[] = [];

  const walk = (abs: string): void => {
    const stat = lstatSync(abs);
    const rel = posixPath(relative(root, abs));
    if (rel === "" || rel === ".") {
      for (const name of readdirSync(abs)) {
        walk(join(abs, name));
      }
      return;
    }
    if (rel.split("/").some((part) => part === "..")) {
      throw new Error(`path traversal: ${rel}`);
    }
    if (stat.isSymbolicLink()) {
      assertInsideRoot(root, abs);
      throw new Error(`symlink escape: ${rel}`);
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        walk(join(abs, name));
      }
      return;
    }
    if (!stat.isFile() || isCredential(rel)) {
      return;
    }
    const data = readFileSync(abs);
    const digest = sha256Bytes(data);
    writeFileSync(join(blobsDir, digest), data);
    entries.push({
      path: rel,
      sha256: digest,
      mode: stat.mode & 0o777,
      size: data.length,
    });
  };

  walk(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, sha256: sha256Canonical(entries) };
}

export async function materializeArchive(archive: LogicalArchive, blobsDir: string, target: string): Promise<void> {
  mkdirSync(target, { recursive: true });
  for (const entry of archive.entries) {
    if (entry.path.split("/").some((part) => part === ".." || part === "")) {
      throw new Error(`path traversal: ${entry.path}`);
    }
    const dest = join(target, ...entry.path.split("/"));
    assertInsideRoot(target, dirname(dest));
    mkdirSync(dirname(dest), { recursive: true });
    const blob = join(blobsDir, entry.sha256);
    const data = readFileSync(blob);
    if (sha256Bytes(data) !== entry.sha256) {
      throw new Error("corrupt archive blob");
    }
    writeFileSync(dest, data, { mode: entry.mode });
    if (entry.symlink) {
      symlinkSync(entry.symlink, dest);
    }
  }
}

export function loadArchive(manifestPath: string): LogicalArchive {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as LogicalArchive;
  if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.sha256 !== "string") {
    throw new Error("corrupt manifest");
  }
  if (sha256Canonical(parsed.entries) !== parsed.sha256) {
    throw new Error("corrupt archive");
  }
  return parsed;
}

export { copyFileSync };
