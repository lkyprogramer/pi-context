#!/usr/bin/env node
import { createHash } from "node:crypto";
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

function liveLane(path, lane) {
  if (!existsSync(path)) fail(`PCR_LIVE_PROVIDER_REQUIRED:${lane}`);
  const report = JSON.parse(readFileSync(path, "utf8"));
  if (report.liveProvider !== true) fail(`PCR_LIVE_PROVIDER_REQUIRED:${lane}`);
  return report;
}

const naturalReport = liveLane(natural, "natural-threshold");
const overflowReport = liveLane(overflow, "overflow");
const recursiveReport = liveLane(recursive, "recursive");
if (naturalReport.triggered !== true) fail("PCR_W5_THRESHOLD_NOT_OBSERVED");
if (overflowReport.overflowObserved !== true) fail("PCR_W5_OVERFLOW_NOT_OBSERVED");
if (overflowReport.hashesChange !== true || overflowReport.tokensStrictlyDecrease !== true) fail("PCR_W5_OVERFLOW_NO_PROGRESS");
if (recursiveReport.threeCompacts !== true) fail("PCR_W5_RECURSIVE_INCOMPLETE");
if (naturalReport.keepRecentTokens !== 20_000 || naturalReport.manualCompact === true) fail("PCR_W5_KEEP_RECENT_LOWERED");
if (overflowReport.usedManualCompactAsOverflow === true) fail("PCR_W5_OVERFLOW_HAND_COMPACT");

process.stdout.write(`${JSON.stringify({ ok: true, publicationClaim: false, semanticDefault: "off" })}\n`);
