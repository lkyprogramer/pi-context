#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CI_EVIDENCE = "docs/pi-context-current-state-audit-next-plan-v1.0.0/evidence";

export class AuditFreezeError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AuditFreezeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function abortIfRequested(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("audit freeze aborted", "AbortError");
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function git(repositoryRoot, args) {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new AuditFreezeError("PCR_AUDIT_GIT_FAILED", { args, stderr: result.stderr });
  }
  return result.stdout.trim();
}

function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else files.push(path);
    }
  }
  return files.sort();
}

export function computeCurrentBaseline({
  repositoryRoot,
  ciEvidenceDirectory,
  signal,
} = {}) {
  abortIfRequested(signal);
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) {
    throw new AuditFreezeError("PCR_AUDIT_INPUT_INVALID", { field: "repositoryRoot" });
  }
  abortIfRequested(signal);
  const porcelain = git(repositoryRoot, ["status", "--porcelain"]);
  if (porcelain.length > 0) {
    throw new AuditFreezeError("PCR_AUDIT_DIRTY_TREE", { porcelain });
  }
  abortIfRequested(signal);
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  if (!/^[0-9a-f]{40}$/u.test(head) || !/^[0-9a-f]{40}$/u.test(tree)) {
    throw new AuditFreezeError("PCR_AUDIT_GIT_FAILED", { head, tree });
  }
  const evidenceRoot = ciEvidenceDirectory ?? join(repositoryRoot, DEFAULT_CI_EVIDENCE);
  const ciHashes = {};
  if (statSync(evidenceRoot, { throwIfNoEntry: false })?.isDirectory()) {
    for (const file of listFiles(evidenceRoot)) {
      abortIfRequested(signal);
      const scoped = relative(repositoryRoot, file).replaceAll("\\", "/");
      ciHashes[scoped] = sha256File(file);
    }
  }
  let reportCommit = head;
  try {
    const reported = git(repositoryRoot, ["log", "-1", "--format=%H", "--", "artifacts/runs/pcr-vs-pi-native"]);
    if (/^[0-9a-f]{40}$/u.test(reported)) reportCommit = reported;
  } catch {
    reportCommit = head;
  }
  const baseline = {
    head,
    tree,
    reportCommit,
    ciHashes,
  };
  const encoded = `${JSON.stringify(baseline, null, 2)}\n`;
  const digest = sha256Bytes(encoded);
  return { baseline, digest, encoded };
}

export function freezeCurrentBaseline({
  repositoryRoot,
  outputDirectory,
  ciEvidenceDirectory,
  signal,
} = {}) {
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory)) {
    throw new AuditFreezeError("PCR_AUDIT_INPUT_INVALID", { field: "outputDirectory" });
  }
  const computed = computeCurrentBaseline({ repositoryRoot, ciEvidenceDirectory, signal });
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "current-baseline.json");
  writeFileSync(outputPath, computed.encoded);
  return { ...computed, outputPath };
}

export function verifyCurrentBaseline({ repositoryRoot, signal } = {}) {
  abortIfRequested(signal);
  const first = computeCurrentBaseline({ repositoryRoot, signal });
  const second = computeCurrentBaseline({ repositoryRoot, signal });
  if (first.digest !== second.digest) {
    throw new AuditFreezeError("PCR_AUDIT_BASELINE_DRIFT", { first: first.digest, second: second.digest });
  }
  return freezeCurrentBaseline({
    repositoryRoot,
    outputDirectory: join(repositoryRoot, "audit", "current"),
    signal,
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const result = freezeCurrentBaseline({
    repositoryRoot: repo,
    outputDirectory: join(repo, "audit", "current"),
  });
  process.stdout.write(`${JSON.stringify({ digest: result.digest, head: result.baseline.head }, null, 2)}\n`);
}
