import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalArm, EvalPair } from "../src/contracts.js";
import { freezeManifest } from "./manifest.js";
import { pairOrder } from "./pairing.js";
import { runSandboxed } from "./sandbox/runner.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface SmokePlan {
  caseIds: string[];
  arms: Array<"B0" | "B2">;
  totalWallBudgetSeconds: number;
  perArmWallBudgetSeconds: number;
  maxModelCallsPerArm: number;
  remainingOnBudgetExhausted: string;
  seed: string;
}

export function loadSmokePlan(): SmokePlan {
  const path = join(here, "../docs/pi-context-native-first-evolution-v5.0.0/eval/smoke-plan.json");
  return JSON.parse(readFileSync(path, "utf8")) as SmokePlan;
}

export function emptyArm(arm: EvalArm["arm"], status: EvalArm["status"] = "not-run"): EvalArm {
  return {
    arm,
    status,
    taskPassed: null,
    criticalViolation: null,
    wallMs: null,
    monetaryCost: null,
    billedTokens: null,
  };
}

export function plannedPair(taskId: string, clusterId: string): EvalPair {
  const sandbox = runSandboxed("true");
  const blocked = sandbox.status === "blocked";
  return {
    kind: "real-run",
    taskId,
    clusterId,
    repetition: 0,
    provenance: "real-independent",
    baseline: emptyArm("B0", blocked ? "blocked" : "not-run"),
    candidate: emptyArm("B2", blocked ? "blocked" : "not-run"),
  };
}

export function plannedSmokePairs(): EvalPair[] {
  const plan = loadSmokePlan();
  return plan.caseIds.map((id) => plannedPair(id, id.startsWith("J05") ? "recovery" : "java"));
}

export function armOrderFor(seed: string, caseId: string): Array<"B0" | "B2"> {
  const ordered = pairOrder(`${seed}:${caseId}`);
  const first = ordered[0];
  return first ? [first[0] === "B2" ? "B2" : "B0", first[0] === "B2" ? "B0" : "B2"] : ["B0", "B2"];
}

export function consumeBudget(remainingSeconds: number, usedSeconds: number): {
  remainingSeconds: number;
  exhausted: boolean;
} {
  const remaining = remainingSeconds - usedSeconds;
  return { remainingSeconds: remaining, exhausted: remaining <= 0 };
}

export function hostManifest() {
  return freezeManifest({
    host: "official-pi",
    piVersion: "0.85.1",
    sourceRevision: "d981de1229ef899957bbe968bc8dcda02a21f477",
    configHash: "pending",
    model: process.env.PCR_LIVE_MODEL ?? process.env.PCR_MODEL ?? "unset",
    pricingIdentity: null,
  });
}
