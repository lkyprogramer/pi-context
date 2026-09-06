#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED = [
  "install-frozen",
  "format-lint",
  "package-boundaries",
  "build",
  "typecheck",
  "unit",
  "contract",
  "acceptance",
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
  "required-gate",
];

const PROTECTION_CONTEXTS = ["required-gate", "compatibility-required"];

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

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  throw error;
}

export function resolveRepo(env = process.env, gitRemote = "") {
  const fromEnv = env.GITHUB_REPOSITORY;
  if (typeof fromEnv === "string" && fromEnv.includes("/")) return fromEnv;
  const match = gitRemote.match(/github\.com[:/](.+?)(?:\.git)?$/m);
  if (match) return match[1];
  fail("PCR_GITHUB_REPOSITORY_MISSING");
}

export function resolveToken(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (typeof token !== "string" || token.length === 0) fail("PCR_GITHUB_TOKEN_MISSING");
  return token;
}

export function assertProtectionPayload(payload) {
  if (!payload || typeof payload !== "object") fail("PCR_GITHUB_PROTECTION_HTTP", { status: 0 });
  if (payload.protected !== true) fail("PCR_BRANCH_UNPROTECTED", { protected: payload.protected ?? false });
  const contexts = payload.protection?.required_status_checks?.contexts
    ?? payload.required_status_checks?.contexts
    ?? [];
  const missing = PROTECTION_CONTEXTS.filter((name) => !contexts.includes(name));
  if (missing.length > 0) fail("PCR_BRANCH_PROTECTION_CONTEXTS_MISSING", { missing, contexts });
  return { protected: true, contexts };
}

export async function fetchBranchProtection({ repo, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${repo}/branches/main`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pi-context-verify-protection",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status < 200 || response.status >= 300) {
    fail("PCR_GITHUB_PROTECTION_HTTP", { status: response.status, body });
  }
  let protection = body.protection;
  if (body.protected === true && !protection) {
    const detailed = await fetchImpl(`${url}/protection`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "pi-context-verify-protection",
      },
    });
    if (detailed.status >= 200 && detailed.status < 300) {
      protection = await detailed.json();
    }
  }
  return assertProtectionPayload({ ...body, protection });
}

function gitRemote() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

const workflowPath = join(new URL("../..", import.meta.url).pathname, ".github/workflows/required.yml");
const invokedDirectly = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-protection.mjs");
if (invokedDirectly) {
  try {
    const text = readFileSync(workflowPath, "utf8");
    const jobs = assertRequiredJobs(text);
    const jobsOnly = process.argv.includes("--jobs-only") || process.env.PCR_PROTECTION_JOBS_ONLY === "1";
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (jobsOnly || typeof token !== "string" || token.length === 0) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        advisory: true,
        code: "PCR_GITHUB_PROTECTION_UNVERIFIED",
        required: jobs,
        protection: "unverified",
        reason: jobsOnly ? "jobs-only" : "missing-token",
      }, null, 2)}\n`);
      process.exit(0);
    }
    const repo = resolveRepo(process.env, gitRemote());
    const protection = await fetchBranchProtection({ repo, token });
    process.stdout.write(`${JSON.stringify({ ok: true, required: jobs, repo, protection }, null, 2)}\n`);
  } catch (error) {
    const code = error?.code ?? "PCR_GITHUB_PROTECTION_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code, details: error?.details ?? { message: error?.message } }, null, 2)}\n`);
    process.exit(1);
  }
}
