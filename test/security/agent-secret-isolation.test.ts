import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { allowBrokerRequest } from "../../eval/sandbox/relay.ts";
import { startCredentialBroker } from "../../scripts/credential-broker.mjs";

const repo = join(import.meta.dirname, "../..");

test("agent launcher does not materialize provider credentials", () => {
  const launcher = readFileSync("eval/local/sandbox/run-agent.sh", "utf8");
  expect(launcher).not.toContain('prov["apiKey"] = key');
  expect(launcher).not.toContain("--network bridge");
  expect(launcher).not.toContain("chmod -R a+rwX");
  expect(launcher).not.toContain('"$SOCK:/run/pctx/broker.sock"');
  expect(launcher).toContain('"$SOCK_DIR:/run/pctx"');
  expect(launcher).toContain('container:$BROKER_CID');
  expect(launcher).not.toContain("PCR_LIVE_API_KEY");
  expect(launcher).not.toContain("PCTX_MODEL_API_KEY");
});

test("episode runner keeps upstream keys in the parent broker", () => {
  const runner = readFileSync(join(repo, "eval/local/run-episode.mjs"), "utf8");
  expect(runner).not.toContain("applyEndpointToModelsJson");
  expect(runner).not.toContain("async function runOnHost");
  expect(runner).toContain("startCredentialBroker");
  expect(runner).toContain("--no-sandbox is removed");
  expect(runner).not.toContain('join(out, "broker.sock")');
  expect(runner).toContain('join("/tmp", "pctx-b-")');
  expect(runner).toContain("darwin-sidecar-netns");
});

test("relay denies metrics and non-chat paths", () => {
  expect(allowBrokerRequest("POST", "/v1/chat/completions")).toBe(true);
  expect(allowBrokerRequest("POST", "/metrics")).toBe(false);
  expect(allowBrokerRequest("GET", "/v1/chat/completions")).toBe(false);
  expect(allowBrokerRequest("POST", "/v1/models")).toBe(false);
});

test("parent broker rejects wrong token, metrics, and oversized bodies", async () => {
  const upstream = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = upstream.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const broker = await startCredentialBroker({
    targetBaseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "UPSTREAM-SECRET-KEY",
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
    allowedToken: "opaque-token",
    maxRequests: 4,
    maxBodyBytes: 64,
    requestTimeoutMs: 2_000,
  });
  try {
    const origin = broker.url.replace(/\/v1\/?$/, "");
    const metrics = await fetch(`${origin}/metrics`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-token", "content-type": "application/json" },
      body: JSON.stringify({ model: "openclaw/Qwen3.8-27B-WORK" }),
    });
    expect(metrics.status).toBe(403);

    const denied = await fetch(`${broker.url}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ model: "openclaw/Qwen3.8-27B-WORK", messages: [] }),
    });
    expect(denied.status).toBe(403);

    const huge = await fetch(`${broker.url}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-token", "content-type": "application/json" },
      body: "x".repeat(128),
    });
    expect(huge.status).toBe(413);

    const ok = await fetch(`${broker.url}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-token", "content-type": "application/json" },
      body: JSON.stringify({ model: "openclaw/Qwen3.8-27B-WORK", messages: [] }),
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text()).ok).toBe(true);
  } finally {
    await broker.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
