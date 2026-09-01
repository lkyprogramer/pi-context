import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { BundleVerifyError, verifyRawRunBundle, type RawRunBundle } from "./bundle.js";

export interface PerArmRawEvidence {
  arm: string;
  failed: boolean;
  retained: boolean;
  sessionJsonl: string;
  compactionEntries: readonly unknown[];
  usage: unknown;
  stderr: string;
  providerRequestIds: readonly string[];
  workspaceManifestSha256: string;
  storeManifestSha256: string;
}

function fail(code: ConstructorParameters<typeof BundleVerifyError>[0], details: Record<string, unknown> = {}): never {
  throw new BundleVerifyError(code, details);
}

function walkFiles(root: string, files: string[] = []): string[] {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(path, files);
    else files.push(path);
  }
  return files.sort();
}

export function workspaceManifestSha256(root: string): string {
  if (typeof root !== "string" || root.length === 0) fail("PCR_BUNDLE_INPUT_INVALID", { field: "workspace" });
  const hash = createHash("sha256");
  for (const file of walkFiles(root)) {
    hash.update(relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function compactionEntries(sessionJsonl: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of sessionJsonl.split("\n")) {
    if (!line.includes('"type":"compaction"')) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string };
      if (parsed.type === "compaction") rows.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return rows;
}

function providerRequestIds(sessionJsonl: string): string[] {
  const ids: string[] = [];
  for (const line of sessionJsonl.split("\n")) {
    const match = /"requestId"\s*:\s*"([^"]+)"/u.exec(line) ?? /"id"\s*:\s*"(req_[^"]+)"/u.exec(line);
    if (match?.[1]) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

export function collectPerArmRawEvidence(input: {
  arm: string;
  failed: boolean;
  sessionFile: string;
  cwd: string;
  stderr: string;
  storeRoot?: string;
}): PerArmRawEvidence {
  if (!input || typeof input !== "object") fail("PCR_BUNDLE_INPUT_INVALID", { field: "input" });
  if (typeof input.arm !== "string" || input.arm.length === 0) fail("PCR_BUNDLE_INPUT_INVALID", { field: "arm" });
  if (typeof input.failed !== "boolean") fail("PCR_BUNDLE_INPUT_INVALID", { field: "failed" });
  if (typeof input.sessionFile !== "string" || !existsSync(input.sessionFile)) {
    fail("PCR_BUNDLE_RAW_MISSING", { field: "sessionFile" });
  }
  if (typeof input.cwd !== "string" || input.cwd.length === 0) fail("PCR_BUNDLE_INPUT_INVALID", { field: "cwd" });
  const sessionJsonl = readFileSync(input.sessionFile, "utf8");
  if (sessionJsonl.length <= 400 && !input.failed) {
    fail("PCR_BUNDLE_PREVIEW_ONLY", { field: "sessionJsonl", bytes: sessionJsonl.length });
  }
  const storeRoot = input.storeRoot
    ?? (existsSync(join(input.cwd, ".context-runtime")) ? join(input.cwd, ".context-runtime") : input.cwd);
  return Object.freeze({
    arm: input.arm,
    failed: input.failed,
    retained: true,
    sessionJsonl,
    compactionEntries: Object.freeze(compactionEntries(sessionJsonl)),
    usage: lastUsage(sessionJsonl),
    stderr: typeof input.stderr === "string" ? input.stderr : "",
    providerRequestIds: Object.freeze(providerRequestIds(sessionJsonl)),
    workspaceManifestSha256: workspaceManifestSha256(input.cwd),
    storeManifestSha256: workspaceManifestSha256(storeRoot),
  });
}

function lastUsage(sessionJsonl: string): unknown {
  let usage: unknown = null;
  for (const line of sessionJsonl.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const parsed = JSON.parse(line) as { message?: { usage?: unknown }; usage?: unknown };
      usage = parsed.message?.usage ?? parsed.usage ?? usage;
    } catch {
      // skip
    }
  }
  return usage;
}

export function keepFailedArmEvidence(evidence: PerArmRawEvidence): PerArmRawEvidence {
  if (!evidence || typeof evidence !== "object") fail("PCR_BUNDLE_INPUT_INVALID", { field: "evidence" });
  if (evidence.failed && evidence.retained !== true) fail("PCR_BUNDLE_FAILED_SAMPLE_DELETED", { arm: evidence.arm });
  return evidence;
}

export function assertFailedSampleRetained(path: string): void {
  if (typeof path !== "string" || path.length === 0) fail("PCR_BUNDLE_INPUT_INVALID", { field: "path" });
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail("PCR_BUNDLE_FAILED_SAMPLE_DELETED", { path });
  }
}

export function writeArmArtifactDir(dir: string, evidence: PerArmRawEvidence): void {
  if (typeof dir !== "string" || dir.length === 0) fail("PCR_BUNDLE_INPUT_INVALID", { field: "dir" });
  keepFailedArmEvidence(evidence);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.jsonl"), evidence.sessionJsonl);
  writeFileSync(join(dir, "workspace.sha256"), `${evidence.workspaceManifestSha256}\n`);
  writeFileSync(join(dir, "store.sha256"), `${evidence.storeManifestSha256}\n`);
  writeFileSync(join(dir, "stderr.txt"), evidence.stderr);
  writeFileSync(join(dir, "raw.json"), `${JSON.stringify(evidence)}\n`);
  if (evidence.failed) writeFileSync(join(dir, "FAILED"), "retained\n");
}

export function assembleRawRunBundle(input: {
  arms: readonly PerArmRawEvidence[];
  configIdentity: string;
  modelIdentity: string;
  providerIdentity: string;
  rawReport: unknown;
  decision: unknown;
}): RawRunBundle {
  if (!input || typeof input !== "object") fail("PCR_BUNDLE_INPUT_INVALID", { field: "input" });
  if (!Array.isArray(input.arms) || input.arms.length === 0) fail("PCR_BUNDLE_RAW_MISSING", { field: "arms" });
  for (const arm of input.arms) keepFailedArmEvidence(arm);
  const sessionJsonl = input.arms.map((arm) => arm.sessionJsonl).join("\n");
  const combined = createHash("sha256");
  const combinedStore = createHash("sha256");
  for (const arm of input.arms) {
    combined.update(arm.workspaceManifestSha256);
    combinedStore.update(arm.storeManifestSha256);
  }
  return verifyRawRunBundle({
    sessionJsonl,
    storeSnapshotSha256: combinedStore.digest("hex"),
    workspaceManifestSha256: combined.digest("hex"),
    configIdentity: input.configIdentity,
    modelIdentity: input.modelIdentity,
    providerIdentity: input.providerIdentity,
    rawReport: input.rawReport,
    decision: input.decision,
  });
}
