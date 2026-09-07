import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

import {
  assertAgentReadablePath,
  authorizeBrokerRoute,
  buildAgentEnvironment,
  isolationProven,
  proveAgentEnvironmentIsolation,
  redactBrokerLog,
  sanitizeBrokerError,
  scanSecretSurfaces,
  startCredentialBroker,
  toolsEnabledAllowed,
  writeArmProviderConfig,
} from "../../scripts/credential-broker.mjs";

const CANARY = "SYNTHETIC_SECRET_123";

it("never passes a real provider key to tool subprocesses", () => {
  const env = buildAgentEnvironment({ PATH: "/usr/bin", HOME: "/tmp/fake", API_KEY: CANARY }, "/tmp/arm");
  expect(JSON.stringify(env)).not.toContain(CANARY);
  expect(env.HOME).toBe("/tmp/arm");
});

it("rejects an absolute host config read from the agent path policy", () => {
  const armHome = mkdtempSync(join(tmpdir(), "pcr-arm-"));
  const hostConfig = join(tmpdir(), "pcr-host-auth.json");
  writeFileSync(hostConfig, JSON.stringify({ apiKey: CANARY }));
  expect(() => assertAgentReadablePath(armHome, hostConfig)).toThrowError(
    expect.objectContaining({ code: "PCR_ISOLATION_HOST_PATH" }),
  );
});

it("does not expose the parent key through agent env or proc", () => {
  const armHome = mkdtempSync(join(tmpdir(), "pcr-arm-"));
  const env = buildAgentEnvironment({ PATH: process.env.PATH, API_KEY: CANARY, OPENAI_API_KEY: CANARY }, armHome);
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
    env,
    encoding: "utf8",
  });
  expect(child.status).toBe(0);
  expect(child.stdout).not.toContain(CANARY);
  expect(JSON.stringify(env)).not.toContain(CANARY);
});

it("rejects unauthorized broker hosts and models", () => {
  expect(() => authorizeBrokerRoute({
    host: "evil.example",
    model: "openclaw/Qwen3.8-27B-WORK",
    allowedHost: "127.0.0.1",
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
  })).toThrowError(expect.objectContaining({ code: "PCR_BROKER_HOST_DENIED" }));
  expect(() => authorizeBrokerRoute({
    host: "127.0.0.1",
    model: "openclaw/other",
    allowedHost: "127.0.0.1",
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
  })).toThrowError(expect.objectContaining({ code: "PCR_BROKER_MODEL_DENIED" }));
  expect(authorizeBrokerRoute({
    host: "127.0.0.1",
    model: "openclaw/Qwen3.8-27B-WORK",
    allowedHost: "127.0.0.1",
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
  }).ok).toBe(true);
});

it("does not echo authorization headers in broker errors or logs", () => {
  const error = sanitizeBrokerError(new Error("authorization: Bearer super-secret-header"));
  expect(error).not.toContain("super-secret-header");
  expect(error).toContain("[redacted]");
  const log = redactBrokerLog({
    requestId: "r1",
    model: "openclaw/Qwen3.8-27B-WORK",
    headers: { Authorization: "Bearer super-secret-header", "content-type": "application/json" },
  });
  expect(JSON.stringify(log)).not.toContain("super-secret-header");
  expect(log.headers.Authorization).toBe("[redacted]");
  expect(log.headers["content-type"]).toBe("application/json");
});

it("does not treat a parent key as isolation proof", () => {
  expect(isolationProven({
    parentHasKey: true,
    agentEnvHasKey: false,
    procHasKey: false,
    hostPathReadable: true,
  })).toBe(false);
});

it("does not require a broker for controlled no-key mode", () => {
  expect(toolsEnabledAllowed({ live: false, isolation: false, brokerReady: false })).toEqual({
    allowed: false,
    reason: "controlled-no-key",
  });
});

it("blocks tools-enabled live when the agent can still read host config", () => {
  const armHome = mkdtempSync(join(tmpdir(), "pcr-arm-"));
  const hostDir = mkdtempSync(join(tmpdir(), "pcr-host-"));
  const hostConfig = join(hostDir, "auth.json");
  writeFileSync(hostConfig, JSON.stringify({ apiKey: CANARY }));
  const proof = proveAgentEnvironmentIsolation({ PATH: process.env.PATH, API_KEY: CANARY }, armHome, hostConfig);
  expect(proof.details.agentEnvHasKey).toBe(false);
  expect(proof.proven).toBe(false);
  expect(toolsEnabledAllowed({ live: true, isolation: proof.proven, brokerReady: true }).allowed).toBe(false);
});

it("counts canary leaks without printing the secret", () => {
  const json = JSON.stringify({ ok: true, note: CANARY });
  const tarMember = `models.json\n${CANARY}\n`;
  const sqliteText = `INSERT INTO t VALUES ('${CANARY}')`;
  const scan = scanSecretSurfaces(["stdout clean", json, tarMember, sqliteText], CANARY);
  expect(scan.hits).toBe(3);
  expect(scan.leaked).toBe(true);
  expect(JSON.stringify(scan)).not.toContain(CANARY);
});

it("does not freeze the parent broker with spawnSync while the runner is live", () => {
  const src = readFileSync(new URL("../../scripts/eval-small.mjs", import.meta.url), "utf8");
  expect(src).not.toMatch(/spawnSync\s*\(\s*jiti/);
  expect(src).toMatch(/spawn\s*\(\s*jiti/);
});

it("broker http rejects a disallowed model without forwarding the parent key", async () => {
  const broker = await startCredentialBroker({
    targetBaseUrl: "http://127.0.0.1:1",
    apiKey: CANARY,
    allowedHost: "127.0.0.1",
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
    maxRequests: 2,
  });
  try {
    const response = await fetch(`${broker.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "openclaw/other", messages: [] }),
    });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
  } finally {
    await broker.close();
  }
});

it("writes arm provider config that points at loopback without copying keys", () => {
  const armHome = mkdtempSync(join(tmpdir(), "pcr-arm-"));
  mkdirSync(armHome, { recursive: true });
  const written = writeArmProviderConfig(armHome, {
    provider: "openclaw",
    model: "openclaw/Qwen3.8-27B-WORK",
    brokerUrl: "http://127.0.0.1:9/v1",
    contextWindow: 200192,
  });
  const models = JSON.parse(readFileSync(written.modelsPath, "utf8"));
  const auth = JSON.parse(readFileSync(written.authPath, "utf8"));
  expect(JSON.stringify(models)).toContain("http://127.0.0.1");
  expect(JSON.stringify({ models, auth })).not.toContain(CANARY);
  expect(() => writeArmProviderConfig(armHome, {
    provider: "openclaw",
    model: "openclaw/Qwen3.8-27B-WORK",
    brokerUrl: "https://api.example/v1",
  })).toThrowError(expect.objectContaining({ code: "PCR_BROKER_INPUT_INVALID" }));
  expect(dirname(written.modelsPath)).toBe(armHome);
});
