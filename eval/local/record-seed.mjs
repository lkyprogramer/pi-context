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

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
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
writeFileSync(join(agentDir, "settings.json"), readFileSync(join(here, "pi-config", "settings.json")));
writeFileSync(join(agentDir, "auth.json"), "{}\n");
for (const [dst, src] of [["l01", "L01/"], ["l04", "L04/initial"], ["l05", "L05/initial"], ["l06", "L06/initial"]]) {
  cpSync(join(repo, "eval/local/fixtures", src), join(cwd, dst), { recursive: true });
  rmSync(join(cwd, dst, "grader"), { recursive: true, force: true });
}
const nonce = randomBytes(16).toString("hex");
mkdirSync(join(cwd, ".probe")); writeFileSync(join(cwd, ".probe", "nonce.txt"), `${nonce}\n`);

const task = (dir) => readFileSync(join(repo, "eval/local/fixtures", dir, "TASK.md"), "utf8").trim();
const prompts = [
  `Work in l01/. Do not fix anything yet: just run ./verify.sh once and report the exact failing assertion message verbatim.`,
  `Run: cat .probe/nonce.txt — then tell me only how many characters it contains. Do not repeat the value.`,
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

let compactions = 0, lastUsage = null;
const unsub = session.subscribe((e) => {
  if (e.type === "compaction_end" && !e.willRetry) compactions++;
  if (e.type === "message_end" && e.message.role === "assistant") lastUsage = e.message.usage ?? null;
});
for (const p of prompts) await session.prompt(p);
unsub();
const file = sessionManager.getSessionFile();
await session.dispose?.();

if (compactions > 0) { console.error(`seed recording hit ${compactions} native compaction(s); the nonce toolResult may be gone. Re-record with a shorter task list or a larger window.`); process.exit(4); }
const jsonl = readFileSync(file, "utf8");
if (!jsonl.includes(nonce)) { console.error("nonce not found in recorded session (model did not cat the probe?)"); process.exit(5); }
cpSync(file, out);
writeFileSync(`${out}.secret`, `${nonce}\n`, { mode: 0o600 });
writeFileSync(`${out}.meta.json`, JSON.stringify({
  recordedAt: new Date().toISOString(), nonceSha256: createHash("sha256").update(nonce).digest("hex"),
  seedSha256: createHash("sha256").update(readFileSync(out)).digest("hex"), entries: jsonl.trim().split("\n").length,
  lastUsage, window: "w64k", prompts: prompts.map((p) => createHash("sha256").update(p).digest("hex")),
}, null, 2));
rmSync(join(cwd, ".probe"), { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
console.log(JSON.stringify({ out, entries: jsonl.trim().split("\n").length, lastUsage }));
