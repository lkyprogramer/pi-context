/**
 * Sanitized, re-computable run bundle. No session text, keys, or thinking.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { capabilitiesFromItt, evaluateTrial, materializeItt, pairsFromItt } from "./gate.mjs";

const FORBIDDEN = /api[_-]?key\s*[:=]|authorization\s*[:=]|Bearer\s+\S|sk-[A-Za-z0-9]{8,}|BEGIN [A-Z]+ PRIVATE/i;

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function hashFiles(root, relativePaths) {
  const files = {};
  for (const rel of relativePaths) {
    const abs = join(root, rel);
    files[rel] = existsSync(abs) ? sha256Bytes(readFileSync(abs)) : null;
  }
  return files;
}

export function hashTree(dir) {
  const files = {};
  if (!existsSync(dir)) return files;
  const walk = (cur, prefix) => {
    for (const name of readdirSync(cur).sort()) {
      const abs = join(cur, name);
      const rel = `${prefix}${name}`;
      if (statSync(abs).isDirectory()) walk(abs, `${rel}/`);
      else files[rel] = sha256Bytes(readFileSync(abs));
    }
  };
  walk(dir, "");
  return files;
}

export function verifyFileHashes(expected, root) {
  for (const [rel, digest] of Object.entries(expected ?? {})) {
    if (!digest) continue;
    const abs = join(root, rel);
    if (!existsSync(abs) || sha256Bytes(readFileSync(abs)) !== digest) {
      return { ok: false, path: rel };
    }
  }
  return { ok: true };
}

export function sanitizeEpisode(ep) {
  return {
    episodeId: ep.episodeId ?? null,
    caseId: ep.manifest?.caseId ?? null,
    arm: ep.manifest?.arm ?? null,
    rep: ep.manifest?.rep ?? null,
    status: ep.status ?? null,
    error: typeof ep.error === "string" ? ep.error.slice(0, 200) : null,
    oracle: {
      passed: ep.oracle?.passed ?? null,
      protectedIntact: ep.oracle?.protectedIntact ?? null,
      nonceCorrect: ep.oracle?.nonceCorrect ?? null,
      honest: ep.oracle?.honest ?? null,
      quotedVerbatim: ep.oracle?.quotedVerbatim ?? null,
    },
    mechanism: {
      folds: ep.mechanism?.folds ?? null,
      replacements: ep.mechanism?.replacements ?? null,
      nativeCompactions: ep.mechanism?.nativeCompactions ?? null,
      historyReads: ep.mechanism?.historyReads ?? null,
      verifiedReads: ep.mechanism?.verifiedReads ?? null,
      foldedErrorResults: ep.mechanism?.foldedErrorResults ?? null,
    },
    accounting: ep.accounting ?? null,
    engine: ep.engine ?? null,
    requests: (ep.requests ?? []).map((r) => ({
      requestId: r.requestId ?? null,
      purpose: r.purpose ?? "agent",
      source: r.source ?? "pi-disjoint",
      usage: r.usage ?? null,
      normalized: r.normalized ?? null,
      hookToFirstDeltaMs: r.hookToFirstDeltaMs ?? null,
    })),
  };
}

export function sanitizeAttempt(a) {
  return {
    episodeId: a.episodeId,
    attemptId: a.attemptId,
    status: a.status,
    requests: (a.requests ?? []).map((r) => ({
      requestId: r.requestId,
      source: r.source,
      purpose: r.purpose ?? "agent",
      usage: r.usage ?? null,
    })),
  };
}

export function assertSanitized(value) {
  const text = JSON.stringify(value);
  if (FORBIDDEN.test(text)) throw new Error("bundle-not-sanitized");
  return true;
}

export function buildBundle(runDir) {
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const plan = manifest.plan;
  if (!plan?.order) throw new Error("frozen plan missing");
  const episodes = [];
  const dir = join(runDir, "episodes");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name, "result.json");
      if (existsSync(p)) episodes.push(JSON.parse(readFileSync(p, "utf8")));
    }
  }
  const itt = materializeItt(plan, episodes);
  const pairs = pairsFromItt(plan, itt);
  const capabilities = capabilitiesFromItt(plan, itt);
  const attempts = [];
  if (existsSync(join(runDir, "attempts.jsonl"))) {
    for (const line of readFileSync(join(runDir, "attempts.jsonl"), "utf8").trim().split("\n").filter(Boolean)) {
      attempts.push(sanitizeAttempt(JSON.parse(line)));
    }
  }
  const decision = evaluateTrial({
    pairs,
    capabilities,
    objective: plan.objective,
    expectedPairs: plan.expectedPairs,
    expectedCapabilities: plan.expectedCapabilities,
    attempts,
  });
  const bundle = {
    manifest: {
      runId: manifest.runId,
      git: manifest.git ?? null,
      hostVersion: manifest.hostVersion ?? null,
      pluginSha256: manifest.pluginSha256 ?? null,
      tarballSha256: manifest.tarballSha256 ?? null,
      distFiles: manifest.distFiles ?? null,
      piPackageHash: manifest.piPackageHash ?? null,
      dirtyDigest: manifest.dirtyDigest ?? null,
      scenarioHash: plan.scenarioHash ?? null,
      model: manifest.model ?? null,
      configHashByArm: manifest.configHashByArm ?? null,
    },
    plan,
    episodes: itt.map(sanitizeEpisode),
    attempts,
    pairs,
    capabilities,
    decision,
  };
  assertSanitized(bundle);
  return bundle;
}

export function writeBundle(runDir, destDir = join(runDir, "bundle")) {
  mkdirSync(destDir, { recursive: true });
  const bundle = buildBundle(runDir);
  writeFileSync(join(destDir, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  return bundle;
}

export function recomputeDecision(bundle) {
  return evaluateTrial({
    pairs: bundle.pairs,
    capabilities: bundle.capabilities,
    objective: bundle.plan.objective,
    expectedPairs: bundle.plan.expectedPairs,
    expectedCapabilities: bundle.plan.expectedCapabilities,
    attempts: bundle.attempts,
  });
}
