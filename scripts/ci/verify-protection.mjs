#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "install-frozen",
  "format-lint",
  "package-boundaries",
  "build",
  "typecheck",
  "unit",
  "integration",
  "oracle-validation",
  "security-fast",
  "pi-contract-0-84-4",
  "packed-install-hermetic",
  "product-vertical",
  "recovery-crash",
  "w1-locked",
  "w2-boundary-smoke",
  "run-bundle-verify",
];

export function requiredContextsFromWorkflow(workflowText) {
  const names = [...workflowText.matchAll(/^  ([a-z0-9][a-z0-9-]*):/gm)].map((match) => match[1]);
  return names.filter((name) => REQUIRED.includes(name));
}

export function assertRequiredJobs(workflowText) {
  const found = new Set(requiredContextsFromWorkflow(workflowText));
  const missing = REQUIRED.filter((name) => !found.has(name));
  if (missing.length > 0) {
    const error = new Error(`missing required jobs: ${missing.join(",")}`);
    error.code = "PCR_CI_REQUIRED_JOBS_MISSING";
    error.details = { missing };
    throw error;
  }
  return REQUIRED.slice();
}

const workflowPath = join(new URL("../..", import.meta.url).pathname, ".github/workflows/required.yml");
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-protection.mjs")) {
  const text = readFileSync(workflowPath, "utf8");
  const jobs = assertRequiredJobs(text);
  process.stdout.write(`${JSON.stringify({ ok: true, required: jobs }, null, 2)}\n`);
}
