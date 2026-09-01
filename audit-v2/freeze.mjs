#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AUDITED_HEAD = "6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31";
export const SOURCE_ARCHIVE_SHA256 = "ac3fd46a8dbdd03ac31e16e7184d263f572680b6a7c27b0cdf8e5d55a4b36155";
export const ZIP_SHA256 = "b14350a2df0164e2bc05add806750f28c8e499a205187e6e1641a9b2d7ab16da";
export const REQUIRED_RUN_ID = "33478592667";
export const COMPATIBILITY_RUN_ID = "33478592798";

const PACK = "docs/pi-context-deep-audit-and-next-iteration-v2.0.0";

const EVIDENCE_COPIES = [
  ["evidence/ci/compat-ubuntu-node24-min-cell.json", "ci/compat-ubuntu-node24-min-cell.json"],
  ["evidence/ci/compat-ubuntu-node24-min-unit.log", "ci/compat-ubuntu-node24-min-unit.log"],
  ["evidence/ci/compatibility-failure-summary.md", "ci/compatibility-failure-summary.md"],
  ["evidence/ci/current-workflow-state.json", "ci/current-workflow-state.json"],
  ["evidence/source-inventory.json", "source-inventory.json"],
  ["evidence/reports/LIVE-COMPARISON.md", "reports/LIVE-COMPARISON.md"],
  ["evidence/reports/deterministic-v3-gate-decision.json", "reports/deterministic-v3-gate-decision.json"],
  ["evidence/reports/natural-threshold.json", "reports/natural-threshold.json"],
  ["evidence/reports/overflow.json", "reports/overflow.json"],
  ["evidence/reports/recursive.json", "reports/recursive.json"],
  ["compliance/previous-task-status.json", "governance/previous-task-status.json"],
  ["BUILD-INFO.json", "pack-build-info.json"],
];

export class AuditV2Error extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AuditV2Error";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function abortIfRequested(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("audit-v2 aborted", "AbortError");
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
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

function requireAbsolute(value, field) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new AuditV2Error("PCR_AUDIT_V2_INPUT_INVALID", { field });
  }
}

export function writeManifest(entries) {
  const lines = [];
  for (const { file, rel } of entries) {
    lines.push(`${sha256File(file)}  ${rel}`);
  }
  return `${lines.join("\n")}\n`;
}

function resolveManifestPath(rel, { evidenceDirectory, auditDirectory, repositoryRoot }) {
  if (rel.startsWith("evidence/")) {
    return join(repositoryRoot ?? dirname(evidenceDirectory), rel);
  }
  if (rel.startsWith("audit-v2/")) {
    return join(repositoryRoot ?? dirname(auditDirectory), rel);
  }
  const fromEvidence = join(evidenceDirectory, rel);
  if (statSync(fromEvidence, { throwIfNoEntry: false })?.isFile()) return fromEvidence;
  return join(auditDirectory, rel);
}

export function verifyAuditV2Manifest({
  evidenceDirectory,
  manifestPath,
  auditDirectory,
  repositoryRoot,
  signal,
} = {}) {
  abortIfRequested(signal);
  requireAbsolute(evidenceDirectory, "evidenceDirectory");
  requireAbsolute(manifestPath, "manifestPath");
  const auditDir = auditDirectory ?? dirname(manifestPath);
  if (!statSync(evidenceDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new AuditV2Error("PCR_AUDIT_V2_MANIFEST_MISSING", { evidenceDirectory });
  }
  if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
    throw new AuditV2Error("PCR_AUDIT_V2_MANIFEST_MISSING", { manifestPath });
  }
  const expected = [];
  for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/)) {
    abortIfRequested(signal);
    if (!line.trim()) continue;
    const sep = line.indexOf("  ");
    if (sep < 0) throw new AuditV2Error("PCR_AUDIT_V2_MANIFEST_INVALID", { line });
    expected.push({ digest: line.slice(0, sep), rel: line.slice(sep + 2) });
  }
  for (const { digest, rel } of expected) {
    abortIfRequested(signal);
    const file = resolveManifestPath(rel, {
      evidenceDirectory,
      auditDirectory: auditDir,
      repositoryRoot,
    });
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new AuditV2Error("PCR_AUDIT_V2_MANIFEST_MISMATCH", { rel, missing: true });
    }
    const actual = sha256File(file);
    if (actual !== digest) {
      throw new AuditV2Error("PCR_AUDIT_V2_MANIFEST_MISMATCH", { rel, expected: digest, actual });
    }
  }
  return { ok: true, files: expected.length };
}

export function freezeAuditV2({
  repositoryRoot,
  packRelative = PACK,
  evidenceDirectory,
  auditDirectory,
  signal,
} = {}) {
  abortIfRequested(signal);
  requireAbsolute(repositoryRoot, "repositoryRoot");
  requireAbsolute(evidenceDirectory, "evidenceDirectory");
  requireAbsolute(auditDirectory, "auditDirectory");
  const packRoot = join(repositoryRoot, packRelative);
  if (!statSync(packRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new AuditV2Error("PCR_AUDIT_V2_PACK_MISSING", { packRoot });
  }
  rmSync(evidenceDirectory, { force: true, recursive: true });
  mkdirSync(evidenceDirectory, { recursive: true });
  const copied = {};
  for (const [fromRel, toRel] of EVIDENCE_COPIES) {
    abortIfRequested(signal);
    const from = join(packRoot, fromRel);
    const to = join(evidenceDirectory, toRel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied[toRel] = sha256File(to);
  }
  const baseline = {
    auditedHead: AUDITED_HEAD,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    zipSha256: ZIP_SHA256,
    requiredRunId: REQUIRED_RUN_ID,
    compatibilityRunId: COMPATIBILITY_RUN_ID,
    packRelative,
    publicationClaim: false,
    releaseReady: false,
    defaultCompactor: "pi-native",
    copied,
  };
  const boundary = {
    executed: [
      "pack-static-validation",
      "github-workflow-artifact-fetch",
      "source-head-match",
    ],
    notExecuted: [
      "local-full-vitest-on-audit-container",
      "post-fix-100x3",
      "natural-200k-threshold",
      "provider-overflow",
      "recursive-three-cycle",
      "github-classic-branch-protection-admin-read",
    ],
  };
  mkdirSync(auditDirectory, { recursive: true });
  const baselinePath = join(auditDirectory, "baseline.json");
  const boundaryPath = join(auditDirectory, "validation-boundary.json");
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  writeFileSync(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`);
  const nestedEvidence = relative(repositoryRoot, evidenceDirectory).replaceAll("\\", "/");
  const nestedAudit = relative(repositoryRoot, auditDirectory).replaceAll("\\", "/");
  const evidencePrefix = nestedEvidence === "evidence" ? "evidence/" : "";
  const auditPrefix = nestedAudit === "audit-v2" ? "audit-v2/" : "";
  const entries = [
    ...listFiles(evidenceDirectory).map((file) => ({
      file,
      rel: `${evidencePrefix}${relative(evidenceDirectory, file).replaceAll("\\", "/")}`,
    })),
    { file: baselinePath, rel: `${auditPrefix}baseline.json` },
    { file: boundaryPath, rel: `${auditPrefix}validation-boundary.json` },
  ];
  const manifest = writeManifest(entries);
  const manifestPath = join(auditDirectory, "MANIFEST.sha256");
  writeFileSync(manifestPath, manifest);
  return {
    baseline,
    boundary,
    manifestPath,
    evidenceDirectory,
    digest: sha256Bytes(Buffer.from(manifest)),
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = freezeAuditV2({
    repositoryRoot: repo,
    evidenceDirectory: join(repo, "evidence"),
    auditDirectory: join(repo, "audit-v2"),
  });
  verifyAuditV2Manifest({
    evidenceDirectory: result.evidenceDirectory,
    auditDirectory: join(repo, "audit-v2"),
    manifestPath: result.manifestPath,
    repositoryRoot: repo,
  });
  process.stdout.write(`${JSON.stringify({ digest: result.digest, files: Object.keys(result.baseline.copied).length }, null, 2)}\n`);
}
