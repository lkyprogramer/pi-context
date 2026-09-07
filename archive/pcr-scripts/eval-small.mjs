#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { preflightIsolation, startCredentialBroker, toolsEnabledAllowed } from "./credential-broker.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/benchmark/src/small-runner.ts");
const jiti = join(root, "node_modules/.bin/jiti");

function loadDotenv(dir) {
  const file = join(dir, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  if (!existsSync(jiti)) {
    process.stderr.write("PCR_SMALL_RUNNER_DEPENDENCY_MISSING\n");
    process.exit(1);
  }
  loadDotenv(root);
  const argv = process.argv.slice(2);
  const preflightOnly = argv.includes("--preflight") || argv.includes("--verify");
  const live = process.env.PCR_LIVE === "1" && !preflightOnly;
  const isolation = preflightIsolation(process.env);
  let toolsAllowed = isolation.toolsEnabledAllowed;
  let reason = isolation.reason;
  let broker = null;
  try {
    if (live) {
      const apiKey = process.env.PCR_LIVE_API_KEY?.trim();
      const baseUrl = process.env.PCR_LIVE_BASE_URL?.trim();
      const model = process.env.PCR_LIVE_MODEL?.trim() || "openclaw/Qwen3.8-27B-WORK";
      if (!apiKey || !baseUrl) {
        toolsAllowed = false;
        reason = "credentials-missing";
      } else {
        broker = await startCredentialBroker({
          targetBaseUrl: baseUrl,
          apiKey,
          allowedHost: "127.0.0.1",
          allowedModel: model,
          maxRequests: 384,
        });
        const tools = toolsEnabledAllowed({
          live: true,
          isolation: isolation.proven,
          brokerReady: true,
        });
        toolsAllowed = tools.allowed;
        reason = tools.reason;
      }
    }
    const env = {
      ...process.env,
      PCR_TOOLS_ENABLED_ALLOWED: toolsAllowed ? "1" : "0",
      PCR_ISOLATION_PROVEN: isolation.proven ? "1" : "0",
      PCR_ISOLATION_REASON: reason,
    };
    if (broker) env.PCR_BROKER_URL = broker.url;
    // spawnSync would freeze this process's event loop and leave the broker
    // unable to accept the agent's HTTP requests (Recv-Q stall).
    const status = await new Promise((resolve, reject) => {
      const child = spawn(jiti, [cli, ...argv], {
        stdio: "inherit",
        cwd: root,
        env,
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve(signal ? 1 : (code ?? 1));
      });
    });
    process.exit(status);
  } finally {
    if (broker) await broker.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
