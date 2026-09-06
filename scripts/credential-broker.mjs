#!/usr/bin/env node
/**
 * Parent-side credential broker helpers. Agent subprocesses must only see
 * the allowlisted environment from buildAgentEnvironment; this file stays
 * in the trusted parent.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const CREDENTIAL_NAME = /(?:^|_)(?:key|token|auth|cookie|secret|password|passwd|credential|api[_-]?key)(?:_|$)/iu;
const HEADER_NAME = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/iu;
const ALLOWED_PARENT_KEYS = new Set([
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PCR_BROKER_URL",
]);

export class CredentialBrokerError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "CredentialBrokerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, details = {}) {
  throw new CredentialBrokerError(code, details);
}

function failInput(field) {
  fail("PCR_BROKER_INPUT_INVALID", { field });
}

function isCredentialName(name) {
  return CREDENTIAL_NAME.test(String(name));
}

/**
 * @param {Readonly<Record<string, string | undefined>>} parent
 * @param {string} armHome
 * @returns {Record<string, string>}
 */
export function buildAgentEnvironment(parent, armHome) {
  if (!parent || typeof parent !== "object") failInput("parent");
  if (typeof armHome !== "string" || armHome.length === 0) failInput("armHome");
  const env = { HOME: armHome };
  for (const key of ALLOWED_PARENT_KEYS) {
    if (isCredentialName(key)) continue;
    const value = parent[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  return env;
}

export function writeArmProviderConfig(armHome, input) {
  if (typeof armHome !== "string" || armHome.length === 0) failInput("armHome");
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.provider !== "string" || input.provider.length === 0) failInput("provider");
  if (typeof input.model !== "string" || input.model.length === 0) failInput("model");
  if (typeof input.brokerUrl !== "string" || !input.brokerUrl.startsWith("http://127.0.0.1")) failInput("brokerUrl");
  const models = {
    providers: {
      [input.provider]: {
        baseUrl: input.brokerUrl,
        api: "openai-completions",
        models: [{ id: input.model, contextWindow: input.contextWindow ?? 200192, maxTokens: input.maxTokens ?? 16384 }],
      },
    },
  };
  writeFileSync(join(armHome, "models.json"), `${JSON.stringify(models, null, 2)}\n`);
  writeFileSync(join(armHome, "auth.json"), `${JSON.stringify({ note: "keys-stay-in-parent-broker" }, null, 2)}\n`);
  return { modelsPath: join(armHome, "models.json"), authPath: join(armHome, "auth.json") };
}

export function isPathInside(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string") failInput("path");
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

export function assertAgentReadablePath(armHome, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) failInput("requestedPath");
  if (!isPathInside(armHome, requestedPath)) {
    fail("PCR_ISOLATION_HOST_PATH", { requestedPath });
  }
}

export function authorizeBrokerRoute(input) {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.host !== "string" || input.host.length === 0) failInput("host");
  if (typeof input.model !== "string" || input.model.length === 0) failInput("model");
  if (input.host !== "127.0.0.1" && input.host !== "localhost") {
    fail("PCR_BROKER_HOST_DENIED", { host: input.host });
  }
  if (typeof input.allowedHost === "string" && input.host !== input.allowedHost) {
    const loopbackAlias = (input.allowedHost === "127.0.0.1" && input.host === "localhost")
      || (input.allowedHost === "localhost" && input.host === "127.0.0.1");
    if (!loopbackAlias) fail("PCR_BROKER_HOST_DENIED", { host: input.host });
  }
  if (typeof input.allowedModel === "string" && input.model !== input.allowedModel) {
    fail("PCR_BROKER_MODEL_DENIED", { model: input.model });
  }
  if (typeof input.maxRequests === "number" && Number.isSafeInteger(input.requestCount) && input.requestCount >= input.maxRequests) {
    fail("PCR_BROKER_BUDGET", { requestCount: input.requestCount });
  }
  return { ok: true };
}

export function redactBrokerLog(entry) {
  if (!entry || typeof entry !== "object") failInput("entry");
  const headers = entry.headers && typeof entry.headers === "object" ? entry.headers : {};
  const nextHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    nextHeaders[name] = HEADER_NAME.test(name) ? "[redacted]" : value;
  }
  return {
    requestId: entry.requestId ?? null,
    model: entry.model ?? null,
    status: entry.status ?? null,
    errorType: entry.errorType ?? null,
    headers: nextHeaders,
  };
}

export function sanitizeBrokerError(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  return text
    .replace(/authorization:\s*.+/giu, "authorization: [redacted]")
    .replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]");
}

export function scanSecretSurfaces(surfaces, canary) {
  if (!Array.isArray(surfaces)) failInput("surfaces");
  if (typeof canary !== "string" || canary.length < 8) failInput("canary");
  let hits = 0;
  for (const surface of surfaces) {
    if (typeof surface !== "string") failInput("surfaces");
    let from = 0;
    while (from <= surface.length) {
      const index = surface.indexOf(canary, from);
      if (index < 0) break;
      hits += 1;
      from = index + canary.length;
    }
  }
  return { hits, leaked: hits > 0 };
}

export function isolationProven(input) {
  if (!input || typeof input !== "object") failInput("input");
  if (input.hostPathReadable === true) return false;
  if (input.agentEnvHasKey === true) return false;
  if (input.procHasKey === true) return false;
  return input.hostPathReadable === false && input.agentEnvHasKey === false && input.procHasKey === false;
}

/**
 * Controlled no-key / preflight mode does not need a broker. Tools-enabled
 * live still requires a passing isolation proof; a parent key is not proof.
 */
export function toolsEnabledAllowed(input) {
  if (!input || typeof input !== "object") failInput("input");
  if (input.live !== true) return { allowed: false, reason: "controlled-no-key" };
  if (input.isolation !== true) return { allowed: false, reason: "isolation-unproven" };
  if (input.brokerReady !== true) return { allowed: false, reason: "broker-unready" };
  return { allowed: true, reason: "isolated-broker" };
}

export function proveAgentEnvironmentIsolation(parent, armHome, hostConfigPath) {
  const env = buildAgentEnvironment(parent, armHome);
  const serialized = JSON.stringify(env);
  const secret = typeof parent.API_KEY === "string" ? parent.API_KEY : "";
  const agentEnvHasKey = secret.length > 0 && serialized.includes(secret);
  const script = `
const fs = require("node:fs");
const secret = ${JSON.stringify(secret)};
const hostPath = ${JSON.stringify(hostConfigPath)};
let readable = false;
try { readable = fs.readFileSync(hostPath, "utf8").includes(secret); } catch {}
const envHit = JSON.stringify(process.env).includes(secret);
process.stdout.write(JSON.stringify({ readable, envHit, home: process.env.HOME }));
`;
  const child = spawnSync(process.execPath, ["-e", script], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (child.status !== 0) fail("PCR_ISOLATION_PROBE_FAILED", { stderr: String(child.stderr ?? "").slice(0, 200) });
  const probe = JSON.parse(child.stdout);
  return {
    proven: isolationProven({
      parentHasKey: secret.length > 0,
      agentEnvHasKey: agentEnvHasKey || probe.envHit === true,
      procHasKey: probe.envHit === true,
      hostPathReadable: probe.readable === true,
    }),
    agentEnv: env,
    details: {
      agentEnvHasKey: agentEnvHasKey || probe.envHit === true,
      hostPathReadable: probe.readable === true,
      home: probe.home,
    },
  };
}

export function preflightIsolation(parent = process.env) {
  const armHome = mkdtempSync(join(tmpdir(), "pcr-arm-home-"));
  const hostDir = mkdtempSync(join(tmpdir(), "pcr-host-home-"));
  const hostConfigPath = join(hostDir, ".pi", "agent", "auth.json");
  const secret = "SYNTHETIC_SECRET_123";
  mkdirSync(dirname(hostConfigPath), { recursive: true });
  writeFileSync(hostConfigPath, JSON.stringify({ apiKey: secret }));
  try {
    const proof = proveAgentEnvironmentIsolation({ ...parent, API_KEY: secret }, armHome, hostConfigPath);
    const tools = toolsEnabledAllowed({
      live: parent.PCR_LIVE === "1",
      isolation: proof.proven,
      brokerReady: false,
    });
    return {
      proven: proof.proven,
      toolsEnabledAllowed: tools.allowed,
      reason: tools.reason,
      details: proof.details,
    };
  } finally {
    rmSync(armHome, { recursive: true, force: true });
    rmSync(hostDir, { recursive: true, force: true });
  }
}
