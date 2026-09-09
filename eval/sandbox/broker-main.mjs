#!/usr/bin/env node
import { startCredentialBroker } from "../../scripts/credential-broker.mjs";

const socketPath = process.env.PCR_BROKER_SOCK || "/run/pctx/broker.sock";
const targetBaseUrl = process.env.PCR_LIVE_BASE_URL || process.env.PCTX_MODEL_BASE_URL;
const apiKey = process.env.PCR_LIVE_API_KEY || process.env.PCTX_MODEL_API_KEY;
const allowedModel = process.env.PCR_LIVE_MODEL || process.env.PCTX_EXPECT_MODEL;
const allowedToken = process.env.PCTX_BROKER_TOKEN;
if (!targetBaseUrl || !apiKey || !allowedModel || !allowedToken) {
  console.error("broker-main missing target/model/path/token in parent env");
  process.exit(1);
}

const broker = await startCredentialBroker({
  targetBaseUrl,
  apiKey,
  allowedHost: "127.0.0.1",
  allowedModel,
  allowedToken,
  maxRequests: Number(process.env.PCTX_BUDGET_MODEL || 64),
  maxBodyBytes: Number(process.env.PCTX_BROKER_MAX_BODY || 2_000_000),
  requestTimeoutMs: Number(process.env.PCTX_BROKER_TIMEOUT_MS || 120_000),
  socketPath,
  socketMode: 0o600,
});
console.log(JSON.stringify({ ready: true, socketPath: broker.socketPath }));
const stop = () => {
  void broker.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
