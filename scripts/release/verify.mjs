#!/usr/bin/env node
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
const natural = join(root, "artifacts/runs/w2-v3-live/natural-threshold/report.json");
const overflow = join(root, "artifacts/runs/w2-v3-live/overflow/report.json");
const recursive = join(root, "artifacts/runs/w2-v3-live/recursive/report.json");

if (existsSync(unrun)) fail("PCR_PUBLICATION_RUN_MISSING");
if (!existsSync(publication)) fail("PCR_PUBLICATION_RUN_MISSING");

const manifest = JSON.parse(readFileSync(publication, "utf8"));
if (manifest.publicationClaim === true) fail("PCR_PUBLICATION_CLAIM_WITHOUT_LIVE");
if (manifest.status === "unrun" || (manifest.completedPairs ?? 0) < 300) fail("PCR_PUBLICATION_RUN_MISSING");

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
