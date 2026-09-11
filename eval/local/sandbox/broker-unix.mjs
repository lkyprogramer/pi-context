/**
 * Darwin sidecar: Unix broker that reads the upstream key from stdin (first line).
 * Key never comes from a file or env.
 */
import { createInterface } from "node:readline";

let startCredentialBroker;
try {
  ({ startCredentialBroker } = await import("/opt/pctx/credential-broker.mjs"));
} catch {
  ({ startCredentialBroker } = await import("../../../scripts/credential-broker.mjs"));
}

const socketPath = process.env.PCTX_BROKER_SOCKET_PATH ?? "/run/pctx/broker.sock";

const key = await new Promise((resolve, reject) => {
  const rl = createInterface({ input: process.stdin });
  let got = false;
  const timer = setTimeout(() => reject(new Error("upstream key not received on stdin")), 5_000);
  rl.once("line", (line) => {
    got = true;
    clearTimeout(timer);
    rl.pause();
    resolve(String(line ?? "").trim());
  });
  rl.once("close", () => {
    if (got) return;
    clearTimeout(timer);
    reject(new Error("stdin closed before upstream key"));
  });
});
if (!key) throw new Error("empty upstream key on stdin");

const broker = await startCredentialBroker({
  targetBaseUrl: process.env.PCR_LIVE_BASE_URL,
  apiKey: key,
  allowedModel: process.env.PCR_LIVE_MODEL,
  allowedToken: process.env.PCTX_BROKER_TOKEN,
  socketPath,
  socketMode: 0o660,
  maxRequests: Number(process.env.PCTX_BUDGET_MODEL || 64),
  maxBodyBytes: Number(process.env.PCTX_BROKER_MAX_BODY || 2_000_000),
  requestTimeoutMs: Number(process.env.PCTX_BROKER_TIMEOUT_MS || 180_000),
});
process.stdout.write(`${JSON.stringify({ ready: true, socketPath })}\n`);
const stop = () => {
  void broker.close().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
