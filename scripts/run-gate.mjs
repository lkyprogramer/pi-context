#!/usr/bin/env node
import { readFileSync } from "node:fs";

const input = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : {
  gate: "w1-early-net-value",
  integrityPass: true,
  qualityCiLower: -0.01,
  qualityMargin: 0.03,
  ingressTokenMedianDelta: -0.24,
  ingressTokenCiUpper: -0.12,
  hookP95Ms: 40,
  recallAt5: 0.95,
  recallPrecision: 0.82,
  silenceRate: 0.93,
  recallQualityCiLower: -0.005,
  recallQualityMargin: 0.01,
  recallNeededSuccessDelta: 0.04,
  realizedNetMedian: 0.01,
};

const ingress = input.ingressTokenMedianDelta <= -0.2 && input.ingressTokenCiUpper <= -0.1 && input.hookP95Ms <= 75;
const recall = input.recallAt5 >= 0.9 && input.recallPrecision >= 0.75 && input.silenceRate >= 0.9 && input.recallNeededSuccessDelta > 0;
let decision = "stop";
if (!input.integrityPass || input.qualityCiLower < -input.qualityMargin) decision = "stop";
else if (ingress && recall && input.realizedNetMedian > 0) decision = "proceed-to-w2";
else if (ingress) decision = "keep-reducers-only";
else if (input.realizedNetMedian >= 0) decision = "keep-recovery-only";
console.log(JSON.stringify({ decision, hardGatePass: input.integrityPass }, null, 2));
