#!/usr/bin/env node
import { readFileSync } from "node:fs";

if (process.argv[2] === "--help" || process.argv.length < 3) {
  console.error("usage: node scripts/run-gate.mjs <gate-input.json>");
  console.error("This CLI only evaluates an existing metrics JSON. It does not invent proceed-to-w2.");
  process.exit(process.argv.length < 3 ? 2 : 0);
}

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ingress = input.ingressTokenMedianDelta <= -0.2 && input.ingressTokenCiUpper <= -0.1 && input.hookP95Ms <= 75;
const recall =
  input.recallAt5 >= 0.9 &&
  input.recallPrecision >= 0.75 &&
  input.silenceRate >= 0.9 &&
  input.recallNeededSuccessDelta > 0 &&
  input.recallQualityCiLower >= -(input.recallQualityMargin ?? 0.01);
let decision = "stop";
if (!input.integrityPass || input.qualityCiLower < -input.qualityMargin) decision = "stop";
else if (ingress && recall && input.realizedNetMedian > 0) decision = "proceed-to-w2";
else if (ingress) decision = "keep-reducers-only";
else if (input.realizedNetMedian >= 0) decision = "keep-recovery-only";
const reasons = [];
if (input.corpusClass) reasons.push(`corpusClass=${input.corpusClass}`);
if (input.publicationClaim === false) reasons.push("publicationClaim=false");
console.log(JSON.stringify({ decision, hardGatePass: Boolean(input.integrityPass && input.qualityCiLower >= -input.qualityMargin), reasons, provenance: input.runId ?? null }, null, 2));
