#!/usr/bin/env node
/**
 * In-VM TCP broker for Docker Desktop. Reads the upstream key from a file
 * mounted only into this container. Listens on 127.0.0.1:8080.
 */
import { readFileSync } from "node:fs";
import { startCredentialBroker } from "./credential-broker.mjs";

const apiKey = readFileSync(process.env.PCTX_UPSTREAM_KEY_FILE || "/run/pctx-secret/upstream.key", "utf8").trim();
const broker = await startCredentialBroker({
  targetBaseUrl: process.env.PCR_LIVE_BASE_URL,
  apiKey,
  allowedModel: process.env.PCR_LIVE_MODEL,
  allowedToken: process.env.PCTX_BROKER_TOKEN,
  listenHost: "127.0.0.1",
  listenPort: 8080,
  maxRequests: Number(process.env.PCTX_BUDGET_MODEL || 64),
  maxBodyBytes: Number(process.env.PCTX_BROKER_MAX_BODY || 2_000_000),
  requestTimeoutMs: Number(process.env.PCTX_BROKER_TIMEOUT_MS || 180_000),
});
console.log(JSON.stringify({ ready: true, port: broker.port }));
const stop = () => {
  void broker.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
