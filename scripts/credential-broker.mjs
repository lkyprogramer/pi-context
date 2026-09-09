#!/usr/bin/env node
/**
 * Parent-side credential broker helpers. Agent subprocesses must only see
 * the allowlisted environment from buildAgentEnvironment; this file stays
 * in the trusted parent.
 */

import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  if (input.token != null && (typeof input.token !== "string" || input.token.length === 0)) failInput("token");
  const models = {
    providers: {
      [input.provider]: {
        baseUrl: input.brokerUrl,
        api: "openai-completions",
        apiKey: input.token ?? "pcr-broker",
        authHeader: true,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
        },
        models: [{
          id: input.model,
          name: input.model,
          reasoning: false,
          input: ["text"],
          contextWindow: input.contextWindow ?? 200192,
          maxTokens: input.maxTokens ?? 16384,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
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

export function canonicalModelId(model) {
  if (typeof model !== "string" || model.length === 0) failInput("model");
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function joinUpstreamUrl(targetBaseUrl, reqUrl) {
  const base = new URL(targetBaseUrl.endsWith("/") ? targetBaseUrl : `${targetBaseUrl}/`);
  const incoming = new URL(reqUrl ?? "/", "http://127.0.0.1");
  let path = incoming.pathname;
  if (path === "/v1" || path.startsWith("/v1/")) path = path.slice(3) || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  return new URL(`.${path}${incoming.search}`, base);
}

/**
 * Parent-only loopback proxy. Agent processes receive only the loopback URL.
 * @param {{
 *   targetBaseUrl: string;
 *   apiKey: string;
 *   allowedHost?: string;
 *   allowedModel: string;
 *   maxRequests?: number;
 *   socketPath?: string;
 * }} input
 */
function allowBrokerHttp(method, reqUrl) {
  if (String(method).toUpperCase() === "CONNECT") return false;
  if (String(method).toUpperCase() !== "POST") return false;
  try {
    const u = new URL(reqUrl ?? "/", "http://127.0.0.1");
    if (u.protocol === "file:" || u.protocol === "unix:") return false;
    if (u.pathname === "/metrics" || u.pathname.endsWith("/metrics")) return false;
    return u.pathname === "/chat/completions" || u.pathname === "/v1/chat/completions";
  } catch {
    return false;
  }
}

export function startCredentialBroker(input) {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.targetBaseUrl !== "string" || !/^https?:\/\//u.test(input.targetBaseUrl)) failInput("targetBaseUrl");
  if (typeof input.apiKey !== "string" || input.apiKey.length === 0) failInput("apiKey");
  if (typeof input.allowedModel !== "string" || input.allowedModel.length === 0) failInput("allowedModel");
  const allowedHost = input.allowedHost ?? "127.0.0.1";
  const maxRequests = input.maxRequests ?? 384;
  const maxBodyBytes = input.maxBodyBytes ?? 2_000_000;
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) failInput("maxRequests");
  let requestCount = 0;
  let revoked = false;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void (async () => {
        if (revoked) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: { type: "PCR_BROKER_REVOKED" } }));
          return;
        }
        if (typeof input.allowedToken === "string") {
          const auth = String(req.headers.authorization ?? "");
          if (auth !== `Bearer ${input.allowedToken}`) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { type: "PCR_BROKER_TOKEN_DENIED" } }));
            return;
          }
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBodyBytes) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: { type: "PCR_BROKER_BUDGET" } }));
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        try {
          if (!allowBrokerHttp(req.method ?? "GET", req.url ?? "/")) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: { type: "PCR_BROKER_PATH_DENIED" } }));
            return;
          }
          const host = String(req.headers.host ?? "127.0.0.1").split(":")[0] || "127.0.0.1";
          let model = input.allowedModel;
          let forwardBody = body;
          if (body.length > 0) {
            const parsed = JSON.parse(body.toString("utf8"));
            if (parsed && typeof parsed === "object" && typeof parsed.model === "string" && parsed.model.length > 0) {
              model = parsed.model;
            }
            if (parsed && typeof parsed === "object") {
              parsed.model = canonicalModelId(input.allowedModel);
              forwardBody = Buffer.from(JSON.stringify(parsed));
            }
          }
          const requestedId = canonicalModelId(model);
          const allowedId = canonicalModelId(input.allowedModel);
          authorizeBrokerRoute({
            host,
            model: requestedId === allowedId ? input.allowedModel : model,
            allowedHost,
            allowedModel: input.allowedModel,
            maxRequests,
            requestCount,
          });
          requestCount += 1;
          const upstreamUrl = joinUpstreamUrl(input.targetBaseUrl, req.url);
          const headers = { authorization: `Bearer ${input.apiKey}` };
          if (typeof req.headers["content-type"] === "string") headers["content-type"] = req.headers["content-type"];
          const upstream = await fetch(upstreamUrl, {
            method: req.method ?? "GET",
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : forwardBody,
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          res.statusCode = upstream.status;
          const contentType = upstream.headers.get("content-type");
          if (contentType) res.setHeader("content-type", contentType);
          if (!upstream.body) {
            res.end();
            return;
          }
          for await (const chunk of upstream.body) {
            res.write(chunk);
          }
          res.end();
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "PCR_BROKER_PROXY";
          res.statusCode = code.startsWith("PCR_BROKER_") ? 403 : 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: { type: code, message: sanitizeBrokerError(error) } }));
        }
      })();
    });
    const closeServers = () => new Promise((closeResolve, closeReject) => {
      revoked = true;
      server.close((err) => (err ? closeReject(err) : closeResolve()));
    });
    server.once("error", reject);
    const finish = (extra) => {
      resolve({
        url: extra.url,
        port: extra.port,
        socketPath: extra.socketPath ?? null,
        close: closeServers,
        requestCount: () => requestCount,
      });
    };
    if (typeof input.socketPath === "string" && input.socketPath.length > 0) {
      if (existsSync(input.socketPath)) unlinkSync(input.socketPath);
      server.listen(input.socketPath, () => {
        chmodSync(input.socketPath, input.socketMode ?? 0o600);
        finish({ url: "http://127.0.0.1:8080/v1", port: 8080, socketPath: input.socketPath });
      });
      return;
    }
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      finish({ url: `http://127.0.0.1:${port}/v1`, port });
    });
  });
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
