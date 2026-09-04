#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

const unrun = join(root, "artifacts/runs/w2-v3-live/UNRUN.md");
const publication = join(root, "artifacts/runs/w2-v3-live/run-manifest.json");
const pairedPublication = join(root, "artifacts/runs/w2-v3-live/paired-gate/run-manifest.json");
const natural = join(root, "artifacts/runs/w2-v3-live/natural-threshold/report.json");
const overflow = join(root, "artifacts/runs/w2-v3-live/overflow/report.json");
const recursive = join(root, "artifacts/runs/w2-v3-live/recursive/report.json");
const rcManifest = join(root, "artifacts/runs/rc/manifest.json");
const rcArchive = join(root, "artifacts/runs/rc/raw-bundle.tar.gz");

if (existsSync(unrun)) fail("PCR_PUBLICATION_RUN_MISSING");
if (!existsSync(publication) || !existsSync(pairedPublication)) fail("PCR_PUBLICATION_RUN_MISSING");

const publicationManifest = JSON.parse(readFileSync(publication, "utf8"));
const hashManifest = JSON.parse(readFileSync(pairedPublication, "utf8"));
if (publicationManifest.runId !== "w2-v3-live" || hashManifest.runId !== "w2-live-native-gate") {
  fail("PCR_PUBLICATION_RUN_ID_MISMATCH");
}
for (const field of ["artifactBytesSha256", "canonicalJsonSha256"]) {
  if (typeof hashManifest[field] !== "string" || !/^[a-f0-9]{64}$/u.test(hashManifest[field])) {
    fail(`PCR_PUBLICATION_HASH_MISSING:${field}`);
  }
}
const reportPath = join(root, "artifacts/runs/w2-v3-live/paired-gate/report.json");
if (!existsSync(reportPath)) fail("PCR_PUBLICATION_RUN_MISSING");
const reportBytes = readFileSync(reportPath);
const report = JSON.parse(reportBytes.toString("utf8"));
if (report.runId !== hashManifest.runId || report.sample?.profile !== hashManifest.profile) {
  fail("PCR_PUBLICATION_RUN_ID_MISMATCH");
}
const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const byteHash = createHash("sha256").update(reportBytes).digest("hex");
const canonicalHash = createHash("sha256").update(canonical(report), "utf8").digest("hex");
if (hashManifest.artifactBytesSha256 !== byteHash || hashManifest.canonicalJsonSha256 !== canonicalHash) {
  fail("PCR_PUBLICATION_HASH_MISMATCH");
}
if (hashManifest.files?.["report.json"] !== byteHash) {
  fail("PCR_PUBLICATION_REPORT_HASH_MISMATCH");
}
if (publicationManifest.publicationClaim === true) fail("PCR_PUBLICATION_CLAIM_WITHOUT_LIVE");
if (publicationManifest.status === "unrun" || (report.sample?.completedPairs ?? 0) < 300) fail("PCR_PUBLICATION_RUN_MISSING");
if (!existsSync(rcManifest)) fail("PCR_RC_MANIFEST_MISSING");
const rc = JSON.parse(readFileSync(rcManifest, "utf8"));
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== head) fail("PCR_GITHUB_SHA_HEAD_MISMATCH");
if (rc.commit !== head) fail("PCR_RC_MANIFEST_HEAD_MISMATCH");
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/commits/${head}/check-runs`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
  if (!response.ok) fail("PCR_CHECKS_UNAVAILABLE");
  const checks = await response.json();
  const names = new Map((checks.check_runs ?? []).map((run) => [run.name, run.conclusion]));
  if (!["Required", "Compatibility"].every((name) => names.get(name) === "success")) fail("PCR_REQUIRED_COMPATIBILITY_NOT_GREEN");
} else if (process.env.GITHUB_ACTIONS === "true") {
  fail("PCR_CHECKS_UNAVAILABLE");
}
if (!existsSync(rcArchive) || !rc.archive || typeof rc.archive.sha256 !== "string") fail("PCR_RC_ARCHIVE_MISSING");
const archiveBytes = readFileSync(rcArchive);
const archiveHash = createHash("sha256").update(archiveBytes).digest("hex");
if (archiveHash !== rc.archive.sha256 || archiveBytes.byteLength !== rc.archive.bytes) fail("PCR_RC_ARCHIVE_HASH_MISMATCH");

function liveLane(path, lane) {
  if (!existsSync(path)) fail(`PCR_LIVE_PROVIDER_REQUIRED:${lane}`);
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (report.liveProvider !== true) fail(`PCR_LIVE_PROVIDER_REQUIRED:${lane}`);
  return report;
}

const naturalReport = liveLane(natural, "natural-threshold");
const overflowReport = liveLane(overflow, "overflow");
const recursiveReport = liveLane(recursive, "recursive");
const naturalArms = Array.isArray(naturalReport.families)
  ? naturalReport.families.flatMap((family) => Object.values(family.armStates ?? {}))
  : [];
if (!naturalArms.some((arm) => arm.arm === "B0" && arm.state === "host-auto-compacted")) fail("PCR_W5_B0_NOT_OBSERVED");
if (!naturalArms.some((arm) => arm.arm === "B2" && arm.state === "bounded-materialized")) fail("PCR_W5_B2_NOT_OBSERVED");
if (overflowReport.overflowObserved !== true) fail("PCR_W5_OVERFLOW_NOT_OBSERVED");
if (overflowReport.hashesChange !== true || overflowReport.tokensStrictlyDecrease !== true) fail("PCR_W5_OVERFLOW_NO_PROGRESS");
if (recursiveReport.threeCompacts !== true) fail("PCR_W5_RECURSIVE_INCOMPLETE");
if (recursiveReport.oracleComplete !== true || recursiveReport.correctionVerified !== true || recursiveReport.branched !== true || recursiveReport.restarted !== true || recursiveReport.sideEffectGuard !== true) fail("PCR_W5_RECURSIVE_ORACLE_INCOMPLETE");
if (naturalReport.keepRecentTokens !== 20_000 || naturalReport.manualCompact === true) fail("PCR_W5_KEEP_RECENT_LOWERED");
if (overflowReport.usedManualCompactAsOverflow === true) fail("PCR_W5_OVERFLOW_HAND_COMPACT");

process.stdout.write(`${JSON.stringify({ ok: true, publicationClaim: false, semanticDefault: "off" })}\n`);
