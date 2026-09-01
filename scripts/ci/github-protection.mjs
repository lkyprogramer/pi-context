#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const REQUIRED_CONTEXTS = ["required-gate", "compatibility-required"];
const DEFAULT_API = "https://api.github.com";

export class GithubProtectionError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "GithubProtectionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function contextsFromClassic(protection) {
  const contexts = protection?.required_status_checks?.contexts;
  return Array.isArray(contexts) ? contexts : [];
}

function contextsFromRulesets(rulesets) {
  const names = [];
  for (const ruleset of Array.isArray(rulesets) ? rulesets : []) {
    for (const rule of ruleset?.rules ?? []) {
      if (rule?.type !== "required_status_checks") continue;
      for (const check of rule?.parameters?.required_status_checks ?? []) {
        if (typeof check?.context === "string") names.push(check.context);
      }
    }
  }
  return names;
}

export async function verifyGithubProtection({
  fetchImpl = fetch,
  apiBase = DEFAULT_API,
  owner = "lkyprogramer",
  repo = "pi-context",
  branch = "main",
  token = process.env.GITHUB_TOKEN,
  signal,
} = {}) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("protection verify aborted", "AbortError");
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pi-context-protection-verify",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const rulesetUrl = `${apiBase}/repos/${owner}/${repo}/rulesets`;
  const classicUrl = `${apiBase}/repos/${owner}/${repo}/branches/${branch}/protection`;
  const rulesetRes = await fetchImpl(rulesetUrl, { headers, signal });
  const classicRes = await fetchImpl(classicUrl, { headers, signal });
  const rulesets = rulesetRes.ok ? await rulesetRes.json() : [];
  const classic = classicRes.ok ? await classicRes.json() : { status: classicRes.status };
  const contexts = [...new Set([...contextsFromRulesets(rulesets), ...contextsFromClassic(classic)])];
  const missing = REQUIRED_CONTEXTS.filter((name) => !contexts.includes(name));
  const summary = {
    ok: missing.length === 0,
    owner,
    repo,
    branch,
    rulesetCount: Array.isArray(rulesets) ? rulesets.length : 0,
    classicStatus: classicRes.status,
    contexts,
    missing,
    required: REQUIRED_CONTEXTS,
  };
  if (missing.length > 0) {
    const error = new GithubProtectionError("PCR_PROTECTION_UNVERIFIED", summary);
    error.summary = summary;
    throw error;
  }
  return summary;
}

export async function applyGithubProtection() {
  throw new GithubProtectionError("PCR_PROTECTION_APPLY_REQUIRES_EXPLICIT_FLAG", {
    hint: "pass --apply with repository admin credentials; verify is read-only",
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("github-protection.mjs");
if (isMain) {
  const mode = process.argv[2] ?? "verify";
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  if (mode === "apply") {
    await applyGithubProtection();
  } else if (mode !== "verify") {
    throw new GithubProtectionError("PCR_PROTECTION_INPUT_INVALID", { mode });
  } else {
    try {
      const summary = await verifyGithubProtection();
      if (out) writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } catch (error) {
      if (error instanceof GithubProtectionError) {
        const summary = error.summary ?? error.details;
        if (out) writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
        process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
        process.exit(1);
      }
      throw error;
    }
  }
}

