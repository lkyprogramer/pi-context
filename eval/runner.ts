import type { EvalArm, EvalPair } from "../src/contracts.js";
import { freezeManifest } from "./manifest.js";
import { runSandboxed } from "./sandbox/runner.js";

export function emptyArm(arm: EvalArm["arm"], status: EvalArm["status"] = "not-run"): EvalArm {
  return {
    arm,
    status,
    taskPassed: null,
    criticalViolation: null,
    wallMs: null,
    monetaryCost: null,
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

export function hostManifest() {
  return freezeManifest({
    host: "official-pi",
    piVersion: "0.85.1",
    sourceRevision: "9767ba275f3e9a5ee0f5c5342249b629ab1b2282",
    configHash: "pending",
    model: process.env.PCR_MODEL ?? process.env.PI_MODEL ?? "unset",
    pricingIdentity: null,
  });
}
