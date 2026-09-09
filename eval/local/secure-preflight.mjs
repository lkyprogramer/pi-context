#!/usr/bin/env node
/**
 * node eval/local/secure-preflight.mjs --canary
 * Exit 0: random canary is invisible to agent env/files/proc/network probes.
 * Exit 3: Docker/image missing (BLOCKED). Never prints the canary.
 */
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCredentialBroker } from "../../scripts/credential-broker.mjs";

const image = process.env.PCTX_SANDBOX_IMAGE || "pctx-t21-sandbox:0.85.1";

if (!process.argv.includes("--canary")) {
  console.error("usage: node eval/local/secure-preflight.mjs --canary");
  process.exit(2);
}

const docker = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" });
if (docker.status !== 0) {
  console.log(JSON.stringify({ ok: false, blocked: true, reason: "sandbox-unavailable" }));
  process.exit(3);
}

const canary = `canary-${randomBytes(16).toString("hex")}`;
const canaryHash = createHash("sha256").update(canary).digest("hex");
const token = `pctx-${randomBytes(12).toString("hex")}`;
const tmp = mkdtempSync(join(tmpdir(), "pctx-preflight-"));
const sock = join(tmp, "broker.sock");
const agent = join(tmp, "agent");
const work = join(tmp, "work");
mkdirSync(agent, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(agent, "models.json"), JSON.stringify({
  providers: { work: { baseUrl: "http://127.0.0.1:8080/v1", apiKey: token } },
}, null, 2));
writeFileSync(join(agent, "auth.json"), "{}\n");

let broker;
try {
  broker = await startCredentialBroker({
    targetBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: canary,
    allowedModel: "openclaw/Qwen3.8-27B-WORK",
    allowedToken: token,
    socketPath: sock,
    maxRequests: 4,
    maxBodyBytes: 4096,
    requestTimeoutMs: 2000,
  });
  const probe = [
    "python3 - <<'PY'",
    "import json, os, pathlib",
    "blob = {",
    "  'env': dict(os.environ),",
    "  'models': pathlib.Path('/home/node/.pi/agent/models.json').read_text() if pathlib.Path('/home/node/.pi/agent/models.json').exists() else '',",
    "  'auth': pathlib.Path('/home/node/.pi/agent/auth.json').read_text() if pathlib.Path('/home/node/.pi/agent/auth.json').exists() else '',",
    "  'proc': pathlib.Path('/proc/1/environ').read_bytes().decode('utf-8','replace') if pathlib.Path('/proc/1/environ').exists() else '',",
    "}",
    "pathlib.Path('/work/probe.json').write_text(json.dumps(blob))",
    "print('wrote')",
    "PY",
    "curl -m 2 -s http://example.com >/dev/null && echo net_ok || echo net_blocked",
  ].join("\n");
  const r = spawnSync("docker", [
    "run", "--rm", "--network", "none", "--read-only",
    "--tmpfs", "/tmp:rw,size=64m",
    "--user", "1000:1000", "--cap-drop", "ALL",
    "-v", `${agent}:/home/node/.pi/agent:ro`,
    "-v", `${work}:/work`,
    "-v", `${sock}:/run/pctx/broker.sock`,
    "-e", `PCTX_BROKER_TOKEN=${token}`,
    image, "sh", "-c", probe,
  ], { encoding: "utf8", timeout: 60_000 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  let dump = "";
  let surfaces = { env: "", models: "", proc: "" };
  if (existsSync(join(work, "probe.json"))) {
    dump = readFileSync(join(work, "probe.json"), "utf8");
    try { surfaces = JSON.parse(dump); } catch { surfaces = { env: dump, models: "", proc: "" }; }
  }
  const env = JSON.stringify(surfaces.env ?? "").includes(canary);
  const models = String(surfaces.models ?? "").includes(canary);
  const proc = String(surfaces.proc ?? "").includes(canary);
  const visible = dump.includes(canary) || output.includes(canary);
  const net = output.includes("net_blocked");
  const report = {
    ok: existsSync(join(work, "probe.json")) && !visible && !env && !models && !proc && net,
    env,
    models,
    proc,
    net,
    canaryHash,
  };
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
} finally {
  await broker?.close?.();
  rmSync(tmp, { recursive: true, force: true });
}
