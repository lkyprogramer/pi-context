#!/usr/bin/env node
import { startCredentialBroker } from "./credential-broker.mjs";

const socketPath = process.env.PCR_BROKER_SOCK || "/run/pctx/broker.sock";
const targetBaseUrl = process.env.PCR_LIVE_BASE_URL;
const apiKey = process.env.PCR_LIVE_API_KEY;
const allowedModel = process.env.PCR_LIVE_MODEL;
if (!targetBaseUrl || !apiKey || !allowedModel) {
  console.error("broker-main missing PCR_LIVE_BASE_URL/PCR_LIVE_API_KEY/PCR_LIVE_MODEL");
  process.exit(1);
}

const broker = await startCredentialBroker({
  targetBaseUrl,
  apiKey,
  allowedHost: "127.0.0.1",
  allowedModel,
  maxRequests: 64,
  socketPath,
  socketMode: 0o666,
});
console.log(JSON.stringify({ ready: true, socketPath: broker.socketPath }));
const stop = () => {
  void broker.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
