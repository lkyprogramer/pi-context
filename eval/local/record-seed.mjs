#!/usr/bin/env node
/**
 * Record a real Pi session (native arm, w64k) to reuse as seed history for H01/H02.
 *
 *   node record-seed.mjs --out seeds/java-three-nonce.jsonl [--allow-host]
 *
 * Sequence inside ONE session (same workspace, sub-directories):
 *   1. l01/  run ./verify.sh once → a genuine isError=true tool result (used by H02)
 *   2. .probe/nonce.txt  the model is asked to `cat` it once → nonce lands in a bash toolResult (used by H01)
 *   3. l04/, l05/, l06/  fix the three v5 Java fixtures normally (adds ≥40k tokens of realistic history)
 * Afterwards: .probe/ is deleted, nonce plaintext goes to <out>.secret (gitignored), meta to <out>.meta.json.
 * The seed JSONL keeps the nonce inside the toolResult body — that is its purpose. It must never appear in prompts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyEndpointToModelsJson, loadRepoEnv } from "./model-endpoint.mjs";
import { nonceToolResultBytes, parseSession } from "./parse-session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
loadRepoEnv(repo);
function officialPiRoot() {
  const local = join(repo, "node_modules/@earendil-works/pi-coding-agent");
  if (existsSync(join(local, "package.json"))) return local;
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const global = join(npmRoot, "@earendil-works/pi-coding-agent");
  if (!existsSync(join(global, "package.json"))) {
    console.error("blocked-environment: @earendil-works/pi-coding-agent@0.85.1 is not installed");
    process.exit(3);
  }
  return global;
}
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter((x) => x.length));
const out = resolve(args.out ?? "eval/local/seeds/java-three-nonce.jsonl");
mkdirSync(dirname(out), { recursive: true });
if (!args["allow-host"]) { console.error("seed recording runs model-written code on the host; pass --allow-host after reading testing/02-isolation.md, or run inside sandbox/run-agent.sh (E02)"); process.exit(2); }

if (spawnSync("bash", [join(here, "ensure-tunnel.sh")]).status !== 0) { console.error("tunnel/engine check failed"); process.exit(3); }

const home = mkdtempSync(join(tmpdir(), "pctx-seed-"));
const cwd = join(home, "work"), agentDir = join(home, ".pi", "agent"), sessionDir = join(home, "sessions");
mkdirSync(cwd, { recursive: true }); mkdirSync(agentDir, { recursive: true }); mkdirSync(sessionDir, { recursive: true });
cpSync(join(here, "pi-config", "w64k", "models.json"), join(agentDir, "models.json"));
applyEndpointToModelsJson(join(agentDir, "models.json"));
const seedSettings = JSON.parse(readFileSync(join(here, "pi-config", "settings.json"), "utf8"));
seedSettings.compaction = { ...(seedSettings.compaction ?? {}), enabled: false };
writeFileSync(join(agentDir, "settings.json"), JSON.stringify(seedSettings, null, 2));
writeFileSync(join(agentDir, "auth.json"), "{}\n");
for (const [dst, src] of [["l01", "L01/"], ["l04", "L04/initial"], ["l05", "L05/initial"], ["l06", "L06/initial"]]) {
  cpSync(join(repo, "eval/local/fixtures", src), join(cwd, dst), { recursive: true });
  rmSync(join(cwd, dst, "grader"), { recursive: true, force: true });
}
const nonce = randomBytes(16).toString("hex");
const probeLines = ["probe-file v1 do-not-treat-first-line-as-secret"];
for (let i = 0; i < 80; i++) probeLines.push(`probe-pad ${String(i).padStart(3, "0")} ${"x".repeat(48)}`);
probeLines.push(nonce);
for (let i = 0; i < 20; i++) probeLines.push(`probe-tail ${i} ${"y".repeat(48)}`);
const probeBody = `${probeLines.join("\n")}\n`;
if (Buffer.byteLength(probeBody, "utf8") < 2048) {
  console.error("probe file is too small to be foldable");
  process.exit(2);
}
mkdirSync(join(cwd, ".probe"));
writeFileSync(join(cwd, ".probe", "nonce.txt"), probeBody);

const task = (dir) => readFileSync(join(repo, "eval/local/fixtures", dir, "TASK.md"), "utf8").trim();
const prompts = [
  `Work in l01/. Do not fix anything yet: just run ./verify.sh once and report the exact failing assertion message verbatim.`,
  `Use the bash tool exactly once with this command and no other command: cat .probe/nonce.txt\nAfter the tool returns, reply with only the character count of that file. Do not repeat, quote, hash, or paraphrase the file contents.`,
  `Work in l04/. ${task("L04")}`,
  `Work in l05/. ${task("L05")}`,
  `Work in l06/. ${task("L06")}`,
];

const npmRoot = officialPiRoot();
const pi = await import(pathToFileURL(join(npmRoot, "dist/index.js")).href);
const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: false });
await loader.reload();
const runtime = await pi.ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
const model = runtime.getModel("work", "openclaw/Qwen3.8-27B-WORK");
const sessionManager = pi.SessionManager.create(cwd, sessionDir);
const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager, modelRuntime: runtime, model, thinkingLevel: "medium" });

let compactions = 0, lastUsage = null, peakInput = 0, promptIndex = 0;
const unsub = session.subscribe((e) => {
  if (e.type === "compaction_end" && !e.willRetry) compactions++;
  if (e.type === "message_end" && e.message.role === "assistant") {
    lastUsage = e.message.usage ?? null;
    peakInput = Math.max(peakInput, Number(lastUsage?.input ?? 0), Number(lastUsage?.totalTokens ?? 0));
  }
});
for (const p of prompts) {
  promptIndex++;
  await session.prompt(p);
  const ctx = session.getContextUsage?.();
  console.error(JSON.stringify({ phase: "task", promptIndex, input: lastUsage?.input ?? null, total: lastUsage?.totalTokens ?? null, peakInput, percent: ctx?.percent ?? null, tokens: ctx?.tokens ?? null }));
}
mkdirSync(join(cwd, ".pad"), { recursive: true });
let pad = 0;
const writePad = (n, lines) => {
  const body = Array.from({ length: lines }, (_, i) => `pad-${n}-LINE ${i + 1} extra-history-token-filler`).join("\n") + "\n";
  writeFileSync(join(cwd, ".pad", `log${n}.txt`), body);
};
const tokensNow = () => {
  const ctx = session.getContextUsage?.();
  const fromCtx = typeof ctx?.percent === "number" ? Math.round((ctx.percent / 100) * 65536) : 0;
  return Math.max(lastUsage?.totalTokens ?? 0, fromCtx);
};
while (Math.max(peakInput, lastUsage?.input ?? 0, tokensNow()) < 40_000 && pad < 8 && compactions === 0) {
  pad++;
  writePad(pad, 800);
  await session.prompt(
    `Use the bash tool exactly once with this command and no other command: cat .pad/log${pad}.txt\nAfter the tool returns, reply with only the line count. Do not modify .probe/, Java sources, or l01/l04/l05/l06.`,
  );
  const ctx = session.getContextUsage?.();
  console.error(JSON.stringify({ phase: "pad", pad, input: lastUsage?.input ?? null, total: lastUsage?.totalTokens ?? null, peakInput, percent: ctx?.percent ?? null, tokens: ctx?.tokens ?? null }));
}
unsub();
const file = sessionManager.getSessionFile();
await session.dispose?.();

if (compactions > 0) { console.error(`seed recording hit ${compactions} native compaction(s); the nonce toolResult may be gone. Re-record with a shorter task list or a larger window.`); process.exit(4); }
const jsonl = readFileSync(file, "utf8");
if (!jsonl.includes(nonce)) { console.error("nonce not found in recorded session (model did not cat the probe?)"); process.exit(5); }
const staging = `${out}.next`;
cpSync(file, staging);
const parsed = parseSession(staging);
const nonceBytes = nonceToolResultBytes(parsed, nonce);
if (nonceBytes < 1024) {
  console.error(`nonce toolResult is ${nonceBytes} bytes (< minFoldableBytes 1024); re-record`);
  process.exit(6);
}
const measuredInput = Math.max(
  lastUsage?.input ?? 0,
  (lastUsage?.input ?? 0) + (lastUsage?.cacheRead ?? 0),
  lastUsage?.totalTokens ?? 0,
  tokensNow(),
);
if (measuredInput < 40_000) {
  console.error(`seed context ${measuredInput} < 40000 (input=${lastUsage?.input ?? "missing"} cacheRead=${lastUsage?.cacheRead ?? "missing"}); left ${staging} for inspection`);
  process.exit(7);
}
cpSync(staging, out);
writeFileSync(`${out}.secret`, `${nonce}\n`, { mode: 0o600 });
writeFileSync(`${out}.meta.json`, JSON.stringify({
  recordedAt: new Date().toISOString(), nonceSha256: createHash("sha256").update(nonce).digest("hex"),
  seedSha256: createHash("sha256").update(readFileSync(out)).digest("hex"), entries: jsonl.trim().split("\n").length,
  lastUsage, peakInput, window: "w64k", padFiles: pad, nonceBytes,
  prompts: prompts.map((p) => createHash("sha256").update(p).digest("hex")),
}, null, 2));
rmSync(join(cwd, ".probe"), { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
console.log(JSON.stringify({ out, entries: jsonl.trim().split("\n").length, lastUsage }));
