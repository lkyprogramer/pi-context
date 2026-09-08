#!/usr/bin/env node
/**
 * Run one Pi episode against the 4090 production NInfer model through the local tunnel.
 *
 *   node run-episode.mjs --case L04 --arm native|observe|balanced --window w262k|w64k --rep 1 --out <dir>
 *                        [--seed <session.jsonl>] [--no-sandbox] [--plugin <abs dist/extension.js>]
 *
 * Writes into <dir>: manifest.json, events.jsonl, requests.jsonl, status.json (observe/balanced),
 * metrics-before.json, metrics-after.json, session/ (copy of the Pi JSONL), result.json.
 * Never writes tool-result bodies into events.jsonl (bytes + sha256 only).
 * E02 adds the sandbox path (sandbox/run-agent.sh); until then --no-sandbox is required.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");            // eval/local → repo root
const args = parseArgs(process.argv.slice(2));
const caseId = need("case"), arm = need("arm"), window = need("window"), out = resolve(need("out"));
const rep = Number(args.rep ?? 0);
const sandboxScript = join(here, "sandbox", "run-agent.sh");
const sandbox = existsSync(sandboxScript) && !("no-sandbox" in args);
const pluginEntry = resolve(args.plugin ?? join(repo, "dist/extension.js"));
const BUDGET = { wallMs: caseId === "H03" ? 3_600_000 : 900_000, modelCalls: caseId === "H03" ? 200 : 40, toolCalls: caseId === "H03" ? 400 : 80 };

if (!["native", "observe", "balanced"].includes(arm)) die(`bad arm ${arm}`);
if (!["w262k", "w64k"].includes(window)) die(`bad window ${window}`);
mkdirSync(out, { recursive: true });

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
const spec = cases.find((c) => c.id === caseId);
if (!spec || spec.runner !== "episode") die(`case ${caseId} is not an episode case`);
if (!spec.arms.includes(arm)) die(`case ${caseId} does not run arm ${arm}`);

// ---- 1. tunnel + engine identity (blocked if wrong) -----------------------------------------
const tunnel = spawnSync("bash", [join(here, "ensure-tunnel.sh")], { encoding: "utf8" });
if (tunnel.status !== 0) blocked(`tunnel: ${tunnel.stdout}${tunnel.stderr}`);
const models = JSON.parse(execFileSync("curl", ["-fsS", "--max-time", "5", "http://127.0.0.1:18343/v1/models"], { encoding: "utf8" }));
const served = models.data?.[0];
if (served?.id !== "openclaw/Qwen3.8-27B-WORK" || Number(served?.meta?.n_ctx) !== 262144) blocked(`engine identity ${JSON.stringify(served)}`);

// ---- 2. workspace + agentDir ---------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), `pctx-${caseId}-${arm}-`));
const cwd = join(home, "work"), agentDir = join(home, ".pi", "agent"), sessionDir = join(home, "sessions");
mkdirSync(cwd, { recursive: true }); mkdirSync(agentDir, { recursive: true }); mkdirSync(sessionDir, { recursive: true });
const fixtureSrc = join(repo, spec.fixture, existsSync(join(repo, spec.fixture, "initial")) ? "initial" : "");
cpSync(fixtureSrc, cwd, { recursive: true });
for (const p of ["grader"]) rmSync(join(cwd, p), { recursive: true, force: true });   // agent never sees grader
git(cwd, ["init", "-q"]); git(cwd, ["add", "-A"]); git(cwd, ["-c", "user.email=e@l", "-c", "user.name=e", "commit", "-qm", "baseline"]);
const baselineSha = protectedSha(cwd, spec.protectedPaths);

cpSync(join(here, "pi-config", window, "models.json"), join(agentDir, "models.json"));
const settings = JSON.parse(readFileSync(join(here, "pi-config", "settings.json"), "utf8"));
if (arm !== "native") {
  if (!existsSync(pluginEntry)) blocked(`plugin entry missing: ${pluginEntry} (run pnpm build)`);
  settings.extensions = [pluginEntry];
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: arm, telemetry: { includeContent: false, jsonl: true, maxLogBytes: 5242880 } }, null, 2));
}
writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2));
writeFileSync(join(agentDir, "auth.json"), "{}\n");
const writtenSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
if (arm === "native" && Array.isArray(writtenSettings.extensions) && writtenSettings.extensions.length > 0) {
  blocked("native arm must not register extensions");
}

let seedCopy = null;
let seedSourceSha = null;
if (spec.seed) {
  const seedAbs = join(repo, spec.seed);
  if (!existsSync(seedAbs)) blocked(`seed missing ${seedAbs}`);
  seedSourceSha = sha256File(seedAbs);
  seedCopy = join(sessionDir, "seed.jsonl");
  cpSync(seedAbs, seedCopy);
  if (sha256File(seedAbs) !== seedSourceSha) blocked("seed source mutated while copying");
}

const manifest = {
  runId: args.run ?? null, caseId, arm, rep, windowProfile: window, sandbox,
  hostVersion: piVersion(),
  pluginEntry: arm === "native" ? null : pluginEntry,
  pluginSha256: arm === "native" ? null : sha256File(pluginEntry),
  model: served.id, nCtx: served.meta.n_ctx, baseUrl: "http://127.0.0.1:18343/v1", thinking: "medium",
  seedSession: spec.seed, seedSha256: seedCopy ? sha256File(seedCopy) : null,
  fixture: spec.fixture, baselineProtectedSha: baselineSha, startedAt: new Date().toISOString(),
  budget: BUDGET,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
snap("before");

// ---- 3. run the agent (host or sandbox) ------------------------------------------------------
const prompts = splitPrompts(readFileSync(join(repo, spec.taskFile), "utf8"));
const t0 = Date.now();
let status = "complete", error = null;
if (sandbox) {
  // E02: sandbox/run-agent.sh <cwd> <agentDir> <out> <window>; it runs run-in-container.mjs with the same logic as runOnHost.
  const r = spawnSync("bash", [join(here, "sandbox", "run-agent.sh"), cwd, agentDir, out, window, JSON.stringify(prompts), seedCopy ?? ""], { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { status = "error"; error = `sandbox exit ${r.status}`; }
} else {
  try { status = await runOnHost({ cwd, agentDir, sessionDir, seedCopy, prompts, out, BUDGET }); }
  catch (e) { status = "error"; error = String(e?.stack ?? e); }
}
const wallMs = Date.now() - t0;
snap("after");

// ---- 4. collect ------------------------------------------------------------------------------
const requests = existsSync(join(out, "requests.jsonl")) ? readFileSync(join(out, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const statusJson = existsSync(join(agentDir, "pctx-status.json")) ? JSON.parse(readFileSync(join(agentDir, "pctx-status.json"), "utf8")) : null;
if (statusJson) writeFileSync(join(out, "status.json"), JSON.stringify(statusJson, null, 2));
if (arm !== "native") {
  if (!statusJson || statusJson.resolvedProfile !== arm) {
    status = "blocked";
    error = `resolvedProfile ${statusJson?.resolvedProfile ?? "missing"} != ${arm}`;
  }
}
const before = JSON.parse(readFileSync(join(out, "metrics-before.json"), "utf8")), after = JSON.parse(readFileSync(join(out, "metrics-after.json"), "utf8"));
const delta = (k) => (before.available && after.available && before[k] != null && after[k] != null && after[k] >= before[k]) ? after[k] - before[k] : null;
const result = {
  manifest, status, error,
  oracle: { passed: null, exitCode: null, protectedIntact: protectedSha(cwd, spec.protectedPaths) === baselineSha, detail: "graded by grade.sh (E02)" },
  requests,
  mechanism: statusJson ? {
    folds: statusJson.folds ?? 0, replacements: statusJson.activePlan?.replacements ?? 0,
    nativeCompactions: statusJson.nativeCompactions ?? 0, historyReads: statusJson.historyReads ?? 0,
    historySearches: statusJson.historySearches ?? 0, verifiedReads: statusJson.verifiedReads ?? 0,
  } : { folds: 0, replacements: 0, nativeCompactions: countEvents(out, "compaction_end"), historyReads: 0, historySearches: 0, verifiedReads: 0 },
  engine: { requestsDelta: delta("requests"), prefixHitTokensDelta: delta("prefixHitTokens"), prefillTokensDelta: delta("prefillTokens"), stableRestoresDelta: delta("stableRestores"), engineRestarted: before.available && after.available && after.requests < before.requests },
  wallMs, workdir: cwd,
};
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ caseId, arm, rep, status, wallMs, requests: requests.length, folds: result.mechanism.folds, prefixHit: result.engine.prefixHitTokensDelta, prefill: result.engine.prefillTokensDelta }));

// =============================================================================================
async function runOnHost({ cwd, agentDir, sessionDir, seedCopy, prompts, out, BUDGET }) {
  const piRoot = officialPiRoot();
  const pi = await import(pathToFileURL(join(piRoot, "dist/index.js")).href);
  const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: false });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors?.length) throw new Error(`extension load errors: ${JSON.stringify(loaded.errors)}`);
  const runtime = await pi.ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const model = runtime.getModel("work", "openclaw/Qwen3.8-27B-WORK");
  if (!model) throw new Error("model not resolved from models.json");
  const sessionManager = seedCopy ? pi.SessionManager.open(seedCopy, sessionDir, cwd) : pi.SessionManager.create(cwd, sessionDir);
  const { session } = await pi.createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager, modelRuntime: runtime, model, thinkingLevel: "medium" });
  await session.bindExtensions?.({ uiContext: { notify() {} } });

  let modelCalls = 0, toolCalls = 0;
  const started = Date.now();
  // TTFT per assistant request: message_start → first message_update that carries content (text/thinking/toolcall delta).
  let reqStartedAt = null, firstTokenAt = null;
  const ev = (o) => appendFileSync(join(out, "events.jsonl"), `${JSON.stringify({ at: Date.now() - started, ...o })}\n`);
  const unsubscribe = session.subscribe((e) => {
    switch (e.type) {
      case "message_start": if (e.message?.role === "assistant") { reqStartedAt = Date.now(); firstTokenAt = null; } break;
      case "message_update": if (e.message?.role === "assistant" && firstTokenAt === null && reqStartedAt !== null) firstTokenAt = Date.now(); break;
      case "message_end": {
        const m = e.message;
        if (m.role === "assistant") {
          modelCalls++;
          const usage = m.usage ?? {};
          const ttftMs = reqStartedAt !== null && firstTokenAt !== null ? firstTokenAt - reqStartedAt : null;
          const totalMs = reqStartedAt !== null ? Date.now() - reqStartedAt : null;
          reqStartedAt = null; firstTokenAt = null;
          const rec = { at: new Date().toISOString(), usage: { input: usage.input ?? null, output: usage.output ?? null, cacheRead: usage.cacheRead ?? null, cacheWrite: usage.cacheWrite ?? null, totalTokens: usage.totalTokens ?? null }, stopReason: m.stopReason ?? null, contextPercentBefore: session.getContextUsage?.()?.percent ?? null, ttftMs, totalMs };
          appendFileSync(join(out, "requests.jsonl"), `${JSON.stringify(rec)}\n`);
          ev({ type: "assistant", usage: rec.usage, stopReason: rec.stopReason });
        }
        break;
      }
      case "tool_execution_start": toolCalls++; ev({ type: "tool_start", toolName: e.toolName, toolCallId: e.toolCallId, argsSha256: sha256(JSON.stringify(e.args ?? {})), action: e.toolName === "pctx_history" ? e.args?.action ?? null : undefined }); break;
      case "tool_execution_end": { const body = JSON.stringify(e.result ?? ""); ev({ type: "tool_end", toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError, bytes: Buffer.byteLength(body), sha256: sha256(body) }); break; }
      case "compaction_start": ev({ type: "compaction_start", reason: e.reason }); break;
      case "compaction_end": ev({ type: "compaction_end", reason: e.reason, aborted: e.aborted, willRetry: e.willRetry, tokensBefore: e.result?.tokensBefore ?? null }); break;
      default: break;
    }
  });
  let status = "complete";
  try {
    for (const p of prompts) {
      if (Date.now() - started > BUDGET.wallMs || modelCalls > BUDGET.modelCalls || toolCalls > BUDGET.toolCalls) { status = "timeout"; break; }
      ev({ type: "prompt", sha256: sha256(p), chars: p.length });
      await withTimeout(session.prompt(p), BUDGET.wallMs - (Date.now() - started));
    }
  } finally {
    unsubscribe();
    // Ask the plugin to persist its StatusView (C03 writes <agentDir>/pctx-status.json on this command and on shutdown).
    try { await session.prompt("/pctx status --json"); } catch { /* native arm has no such command */ }
    const file = sessionManager.getSessionFile?.();
    if (file && existsSync(file)) { mkdirSync(join(out, "session"), { recursive: true }); cpSync(file, join(out, "session", "session.jsonl")); }
    await session.dispose?.();
  }
  return status;
}

function officialPiRoot() {
  const local = join(repo, "node_modules/@earendil-works/pi-coding-agent");
  if (existsSync(join(local, "package.json"))) return local;
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const global = join(npmRoot, "@earendil-works/pi-coding-agent");
  if (!existsSync(join(global, "package.json"))) die("blocked-environment: @earendil-works/pi-coding-agent@0.85.1 is not installed");
  return global;
}
function piVersion() {
  try { return execFileSync("pi", ["--version"], { encoding: "utf8" }).trim(); }
  catch {
    const pkg = JSON.parse(readFileSync(join(officialPiRoot(), "package.json"), "utf8"));
    return String(pkg.version ?? "unknown");
  }
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`episode wall budget exceeded (${ms} ms)`)), Math.max(1000, ms)))]); }
function splitPrompts(md) {
  // Prompt sections are "## P<n>" headings between the two "---" rules; fixture TASK.md without headings is a single prompt.
  const body = md.includes("\n---\n") ? md.split("\n---\n")[1] ?? md : md;
  const parts = body.split(/^## P\d+\s*$/m).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [md.trim()];
}
function snap(name) { spawnSync("bash", [join(here, "metrics-snap.sh"), join(out, `metrics-${name}.json`)], { stdio: "ignore" }); if (!existsSync(join(out, `metrics-${name}.json`))) writeFileSync(join(out, `metrics-${name}.json`), '{"available":false}'); }
function countEvents(dir, type) { const f = join(dir, "events.jsonl"); if (!existsSync(f)) return 0; return readFileSync(f, "utf8").split("\n").filter((l) => l.includes(`"type":"${type}"`) && !l.includes('"willRetry":true')).length; }
function protectedSha(root, paths) { const h = createHash("sha256"); for (const p of paths ?? []) { const abs = join(root, p); if (!existsSync(abs)) { h.update(`missing:${p}`); continue; } const files = execFileSync("find", [abs, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort(); for (const f of files) { h.update(f.slice(root.length)); h.update(readFileSync(f)); } } return h.digest("hex"); }
function git(dir, a) { execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" }); }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function sha256File(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith("--")) continue; const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true; } return o; }
function need(k) { if (!args[k]) die(`--${k} required`); return String(args[k]); }
function die(m) { console.error(m); process.exit(2); }
function blocked(reason) { const r = { manifest: { caseId, arm, rep, windowProfile: window }, status: "blocked", error: reason }; writeFileSync(join(out, "result.json"), JSON.stringify(r, null, 2)); console.log(JSON.stringify({ caseId, arm, rep, status: "blocked", reason })); process.exit(0); }
