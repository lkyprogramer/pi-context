#!/usr/bin/env node
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCredentialBroker } from "../../scripts/credential-broker.mjs";

const IMAGE = process.env.PCR_SANDBOX_IMAGE || "pctx-t21-sandbox:0.85.1";

function dockerArgs(workDir, socketDir, command) {
  return [
    "run", "--rm", "--network", "none", "--read-only",
    "--tmpfs", "/tmp:uid=1000,gid=1000", "--tmpfs", "/home/node:uid=1000,gid=1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--memory", "512m", "--pids-limit", "256", "--user", "1000:1000",
    "-v", `${workDir}:/work:rw`, "-v", `${socketDir}:/run/pctx:rw`, "-w", "/work",
    IMAGE, ...command,
  ];
}

const work = mkdtempSync(join(tmpdir(), "pctx-unix-work-"));
const sockDir = mkdtempSync(join(tmpdir(), "pctx-unix-sock-"));
const sock = join(sockDir, "broker.sock");
const out = { kind: "t21-unix-relay-smoke", status: "blocked", error: null, deniedConnect: null, chatStatus: null };

const upstream = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ id: "upstream", object: "chat.completion", choices: [] }));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const port = upstream.address().port;
let broker;
try {
  broker = await startCredentialBroker({
    targetBaseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "test-key",
    allowedModel: "smoke-model",
    socketPath: sock,
  });
  const denied = execFileSync("docker", dockerArgs(work, sockDir, ["node", "-e", "fetch('http://127.0.0.1:8080/v1/models').then(r=>r.status).then(s=>console.log('DENIED_STATUS='+s)).catch(e=>console.log('DENIED_ERR'))"]), { encoding: "utf8", timeout: 30_000 });
  out.deniedConnect = denied.trim();
  const chat = execFileSync("docker", dockerArgs(work, sockDir, ["node", "-e", "fetch('http://127.0.0.1:8080/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'smoke-model',messages:[]})}).then(async r=>{console.log('CHAT_STATUS='+r.status); console.log(await r.text())})"]), { encoding: "utf8", timeout: 30_000 });
  out.chatStatus = chat.trim();
  out.status = /CHAT_STATUS=200/.test(chat) && /DENIED_STATUS=403/.test(denied) ? "passed" : "failed";
} catch (error) {
  out.error = String(error).slice(0, 800);
} finally {
  await broker?.close?.();
  await new Promise((resolve) => upstream.close(resolve));
  rmSync(work, { recursive: true, force: true });
  rmSync(sockDir, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.status === "passed" ? 0 : 1);
