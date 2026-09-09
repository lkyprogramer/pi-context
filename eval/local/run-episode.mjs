#!/usr/bin/env node
/**
 * Run one Pi episode against the live NInfer OpenAI-compat endpoint.
 *
 *   node run-episode.mjs --case L04 --arm native|observe|balanced --window w262k|w64k --rep 1 --out <dir>
 *                        [--seed <session.jsonl>] [--no-sandbox] [--plugin <abs dist/extension.js>]
 *
 * Writes into <dir>: manifest.json, events.jsonl, requests.jsonl, status.json (observe/balanced),
 * metrics-before.json, metrics-after.json, session/ (copy of the Pi JSONL), result.json.
 * Never writes tool-result bodies into events.jsonl (bytes + sha256 only).
 * Sandbox is the default. --no-sandbox is only allowed for H03.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { foldedErrorCount, nonceEntryIds, nonceVerifiedReads, parseSession, verbatimQuote } from "./parse-session.mjs";
import { applyEndpointToModelsJson, engineOk, fetchModels, loadRepoEnv, modelEndpoint, servedIdentity } from "./model-endpoint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");            // eval/local → repo root
loadRepoEnv(repo);
const args = parseArgs(process.argv.slice(2));
const caseId = need("case"), arm = need("arm"), window = need("window"), out = resolve(need("out"));
const rep = Number(args.rep ?? 0);
const sandboxScript = join(here, "sandbox", "run-agent.sh");
const originalHome = process.env.HOME;
const pluginEntry = resolve(args.plugin ?? join(repo, "dist/extension.js"));
const BUDGET = { wallMs: caseId === "H03" ? 3_600_000 : 900_000, modelCalls: caseId === "H03" ? 200 : 40, toolCalls: caseId === "H03" ? 400 : 80 };

mkdirSync(out, { recursive: true });
if (!["native", "observe", "balanced"].includes(arm)) die(`bad arm ${arm}`);
if (!["w262k", "w64k"].includes(window)) die(`bad window ${window}`);

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
const spec = cases.find((c) => c.id === caseId);
if (!spec || spec.runner !== "episode") die(`case ${caseId} is not an episode case`);
if (!spec.arms.includes(arm)) die(`case ${caseId} does not run arm ${arm}`);
const sandbox = spec.sandbox !== false && !("no-sandbox" in args);
if (("no-sandbox" in args || spec.sandbox === false) && caseId !== "H03") {
  blocked("host execution of model-written code is only allowed for H03");
}
if (sandbox && !existsSync(sandboxScript)) blocked("sandbox/run-agent.sh missing");

// ---- 1. endpoint + engine identity (blocked if wrong) ---------------------------------------
const tunnel = spawnSync("bash", [join(here, "ensure-tunnel.sh")], { encoding: "utf8" });
if (tunnel.status !== 0) blocked(`tunnel: ${tunnel.stdout}${tunnel.stderr}`);
let models;
try { models = fetchModels(); } catch (e) { blocked(`models fetch: ${e}`); }
const { served, id: servedId, nCtx } = servedIdentity(models);
if (!engineOk(models)) blocked(`engine identity ${JSON.stringify(served)}`);
const { baseUrl } = modelEndpoint();

// ---- 2. workspace + agentDir ---------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), `pctx-${caseId}-${arm}-`));
const cwd = join(home, "work"), agentDir = join(home, ".pi", "agent"), sessionDir = join(home, "sessions");
mkdirSync(cwd, { recursive: true }); mkdirSync(agentDir, { recursive: true }); mkdirSync(sessionDir, { recursive: true });
if (caseId === "H03") {
  setupH03Workspace(cwd, repo, out);
} else {
  const fixtureSrc = join(repo, spec.fixture, existsSync(join(repo, spec.fixture, "initial")) ? "initial" : "");
  cpSync(fixtureSrc, cwd, { recursive: true });
  for (const p of ["grader"]) rmSync(join(cwd, p), { recursive: true, force: true });   // agent never sees grader
}
git(cwd, ["init", "-q"]); git(cwd, ["add", "-A"]); git(cwd, ["-c", "user.email=e@l", "-c", "user.name=e", "commit", "-qm", "baseline"]);
const baselineSha = protectedSha(cwd, spec.protectedPaths);

cpSync(join(here, "pi-config", window, "models.json"), join(agentDir, "models.json"));
applyEndpointToModelsJson(join(agentDir, "models.json"));
const settings = JSON.parse(readFileSync(join(here, "pi-config", "settings.json"), "utf8"));
if (arm !== "native") {
  if (!existsSync(pluginEntry)) blocked(`plugin entry missing: ${pluginEntry} (run pnpm build)`);
  // Host loads via additionalExtensionPaths (a real package with pi.extensions). Putting the
  // same file in settings.extensions as well double-registers and crashes createAgentSession.
  if (sandbox) settings.extensions = ["/plugin/extension.js"];
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
  model: servedId, nCtx, baseUrl, thinking: "medium",
  seedSession: spec.seed, seedSha256: seedCopy ? sha256File(seedCopy) : null,
  fixture: spec.fixture, baselineProtectedSha: baselineSha, startedAt: new Date().toISOString(),
  budget: BUDGET,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
snap("before");

// ---- 3. run the agent (host or sandbox) ------------------------------------------------------
const prompts = caseId === "H03" ? h03Prompts(repo) : splitPrompts(readFileSync(join(repo, spec.taskFile), "utf8"));
const t0 = Date.now();
let status = "complete", error = null;
if (sandbox) {
  writeFileSync(join(out, "prompts.json"), JSON.stringify(prompts));
  if (seedCopy) cpSync(seedCopy, join(out, "seed.jsonl"));
  const r = spawnSync("bash", [sandboxScript, cwd, agentDir, out, window], {
    encoding: "utf8", timeout: BUDGET.wallMs + 60_000, killSignal: "SIGKILL",
    env: {
      ...process.env,
      PCTX_BUDGET_WALL_MS: String(BUDGET.wallMs),
      PCTX_BUDGET_MODEL: String(BUDGET.modelCalls),
      PCTX_BUDGET_TOOLS: String(BUDGET.toolCalls),
    },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 3) {
    status = "blocked";
    error = (r.stderr || r.stdout || "sandbox image missing").trim();
  } else if (r.status !== 0) {
    status = "error";
    error = `sandbox exit ${r.status}`;
  } else if (existsSync(join(out, "container-status.json"))) {
    const cs = JSON.parse(readFileSync(join(out, "container-status.json"), "utf8"));
    if (cs.status && cs.status !== "complete") status = cs.status;
  }
} else {
  try { status = await runOnHost({ cwd, agentDir, sessionDir, seedCopy, prompts, out, BUDGET }); }
  catch (e) {
    status = "error";
    error = String(e?.stack ?? e);
    writeFileSync(join(out, "host-error.txt"), error);
  } finally {
    // Docker Desktop/OrbStack reads $HOME/.docker; grading after a host episode must use the real home.
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
}
const wallMs = Date.now() - t0;
snap("after");

// ---- 4. collect ------------------------------------------------------------------------------
const requests = existsSync(join(out, "requests.jsonl")) ? readFileSync(join(out, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const statusJson = existsSync(join(agentDir, "pctx-status.json")) ? JSON.parse(readFileSync(join(agentDir, "pctx-status.json"), "utf8")) : null;
if (statusJson) writeFileSync(join(out, "status.json"), JSON.stringify(statusJson, null, 2));
if (arm !== "native") {
  if (!statusJson || statusJson.resolvedProfile !== arm) {
    const profileErr = `resolvedProfile ${statusJson?.resolvedProfile ?? "missing"} != ${arm}`;
    if (status === "error") error = `${error}; ${profileErr}`;
    else {
      status = "blocked";
      error = profileErr;
    }
  }
}
const before = JSON.parse(readFileSync(join(out, "metrics-before.json"), "utf8")), after = JSON.parse(readFileSync(join(out, "metrics-after.json"), "utf8"));
const delta = (k) => (before.available && after.available && before[k] != null && after[k] != null && after[k] >= before[k]) ? after[k] - before[k] : null;
const oracle = gradeCandidate(caseId, cwd, spec);
if (spec.evidence?.kind === "verbatim-quote") {
  const sessionFile = join(out, "session", "session.jsonl");
  let parsed = existsSync(sessionFile) ? parseSession(sessionFile) : null;
  if (parsed) {
    oracle.quotedVerbatim = verbatimQuote(parsed, {
      linePattern: spec.evidence.linePattern,
      sinceMs: new Date(manifest.startedAt).getTime(),
    });
  }
}
copyTelemetry(agentDir, out);
const sessionFile = join(out, "session", "session.jsonl");
const parsed = existsSync(sessionFile) ? parseSession(sessionFile) : null;
const foldEvents = loadFoldEvents(out, agentDir);
const foldedEntryIds = [
  ...new Set([
    ...(statusJson?.activePlan?.entryIds ?? []),
    ...foldEvents.flatMap((f) => f.addedEntryIds ?? []),
  ]),
];
const secretFile = nonceSecret(spec);
const nonce = secretFile && existsSync(secretFile) ? readFileSync(secretFile, "utf8").trim() : "";
const nonceIds = parsed && nonce ? nonceEntryIds(parsed, nonce) : [];
const telemetryPresent = existsSync(join(out, "telemetry")) || existsSync(join(agentDir, "pctx", "telemetry"));
const foldEvidenceKnown = Boolean(
  parsed
  && (
    foldEvents.length > 0
    || telemetryPresent
    || (statusJson != null && (statusJson.folds ?? 0) === 0)
    || (statusJson?.activePlan?.entryIds?.length)
  ),
);
if (oracle.missingGrade && status === "complete") {
  status = "blocked";
  error = oracle.detail ?? "grade.sh wrote no grade.json";
  oracle.passed = null;
}
const result = {
  manifest, status, error,
  oracle,
  requests,
  foldEvents,
  mechanism: {
    folds: statusJson != null ? (statusJson.folds ?? 0) : (foldEvents.length > 0 ? foldEvents.length : null),
    replacements: statusJson?.activePlan?.replacements ?? null,
    nativeCompactions: statusJson?.nativeCompactions ?? (existsSync(join(out, "events.jsonl")) ? countEvents(out, "compaction_end") : null),
    historyReads: parsed ? parsed.historyReads : null,
    historySearches: parsed ? parsed.historySearches : null,
    verifiedReads: parsed ? parsed.verifiedReads : null,
    nonceVerifiedReads: parsed && nonce ? nonceVerifiedReads(parsed, nonce) : (parsed ? 0 : null),
    foldedErrorResults: parsed && foldEvidenceKnown ? foldedErrorCount(parsed.errorResultIds ?? [], foldedEntryIds) : null,
    nonceFolded: parsed && nonce ? (nonceIds.length ? nonceIds.some((id) => foldedEntryIds.includes(id)) : false) : null,
    savedTokensEstimate: foldEvents.length ? foldEvents.reduce((s, f) => s + (f.savedTokensEstimate ?? 0), 0) : null,
    invalidatedTokensEstimate: foldEvents.length ? foldEvents.reduce((s, f) => s + (f.invalidatedTokensEstimate ?? 0), 0) : null,
  },
  engine: { requestsDelta: delta("requests"), prefixHitTokensDelta: delta("prefixHitTokens"), prefillTokensDelta: delta("prefillTokens"), stableRestoresDelta: delta("stableRestores"), engineRestarted: before.available && after.available && after.requests < before.requests },
  wallMs, workdir: cwd,
};
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ caseId, arm, rep, status, wallMs, requests: requests.length, folds: result.mechanism.folds, prefixHit: result.engine.prefixHitTokensDelta, prefill: result.engine.prefillTokensDelta }));
process.exit(0);

// =============================================================================================
async function runOnHost({ cwd, agentDir, sessionDir, seedCopy, prompts, out, BUDGET }) {
  process.env.HOME = home;
  const piRoot = officialPiRoot();
  const pi = await import(pathToFileURL(join(piRoot, "dist/index.js")).href);
  const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const extra = [];
  if (arm !== "native") {
    const staging = join(home, "pctx-plugin");
    mkdirSync(join(staging, "dist"), { recursive: true });
    cpSync(join(repo, "dist"), join(staging, "dist"), { recursive: true });
    writeFileSync(join(staging, "package.json"), JSON.stringify({
      name: "pi-context", version: "6.1.0-eval", type: "module", pi: { extensions: ["./dist/extension.js"] },
    }));
    extra.push(staging);
  }
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: extra, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: false });
  await loader.reload();
  const loaded = loader.getExtensions();
  writeFileSync(join(out, "extensions.json"), JSON.stringify({
    errors: loaded.errors ?? [],
    paths: (loaded.extensions ?? []).map((e) => e.path ?? e.resolvedPath ?? e.name ?? null),
    count: loaded.extensions?.length ?? 0,
  }, null, 2));
  if (loaded.errors?.length) throw new Error(`extension load errors: ${JSON.stringify(loaded.errors)}`);
  if (arm !== "native" && !(loaded.extensions?.length)) throw new Error("plugin failed to load (0 extensions)");
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
    try { await withTimeout(session.prompt("/pctx status --json"), 8_000); } catch { /* native arm or command UI hang */ }
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
function setupH03Workspace(cwd, repo, episodeOut) {
  const ids = ["L01", "L02", "L03", "L04", "L05", "L06"];
  for (let i = 0; i < ids.length; i++) {
    const root = join(repo, "eval/local/fixtures", ids[i]);
    const src = existsSync(join(root, "initial")) ? join(root, "initial") : root;
    const dst = join(cwd, `t${i + 1}`);
    cpSync(src, dst, { recursive: true });
    rmSync(join(dst, "grader"), { recursive: true, force: true });
  }
  mkdirSync(join(cwd, "logs"), { recursive: true });
  const marked = 7;
  const markLine = 1700;
  for (let n = 1; n <= 12; n++) {
    const lines = [];
    for (let i = 1; i <= 2500; i++) {
      lines.push(n === marked && i === markLine
        ? `[ERROR] FIRST-ERROR-MARKER at build-${String(n).padStart(2, "0")} line ${i}`
        : `[INFO] maven-build-${String(n).padStart(2, "0")} line=${i} compiling module ok elapsed=${i}ms`);
    }
    writeFileSync(join(cwd, "logs", `build-${String(n).padStart(2, "0")}.log`), `${lines.join("\n")}\n`);
  }
  writeFileSync(join(episodeOut, "marker.json"), JSON.stringify({
    file: `logs/build-${String(marked).padStart(2, "0")}.log`, line: markLine, token: "FIRST-ERROR-MARKER",
  }, null, 2));
}
function h03Prompts(repo) {
  const ids = ["L01", "L02", "L03", "L04", "L05", "L06"];
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const task = readFileSync(join(repo, "eval/local/fixtures", ids[i], "TASK.md"), "utf8").trim();
    out.push(`Work in t${i + 1}/: ${task}`);
    const a = String(i * 2 + 1).padStart(2, "0");
    const b = String(i * 2 + 2).padStart(2, "0");
    out.push(`Before continuing, run: cat logs/build-${a}.log and cat logs/build-${b}.log — summarise in one line whether they show a successful build.`);
  }
  out.push("Which of the twelve logs contained the string FIRST-ERROR-MARKER, and on which line? Quote the line.");
  return out;
}
function snap(name) { spawnSync("bash", [join(here, "metrics-snap.sh"), join(out, `metrics-${name}.json`)], { stdio: "ignore" }); if (!existsSync(join(out, `metrics-${name}.json`))) writeFileSync(join(out, `metrics-${name}.json`), '{"available":false}'); }
function gradeCandidate(id, candidate, spec) {
  const gradeOut = join(out, "grade");
  mkdirSync(gradeOut, { recursive: true });
  const secret = nonceSecret(spec);
  const argv = [join(here, "grade.sh"), id, candidate, gradeOut];
  if (secret) argv.push(secret);
  const r = spawnSync("bash", argv, { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const gradePath = join(gradeOut, "grade.json");
  if (!existsSync(gradePath)) {
    return { passed: null, exitCode: r.status, protectedIntact: null, detail: "grade.sh wrote no grade.json", missingGrade: true };
  }
  const g = JSON.parse(readFileSync(gradePath, "utf8"));
  return {
    passed: g.passed ?? false,
    exitCode: g.exitCode ?? r.status,
    protectedIntact: g.protectedIntact ?? false,
    outsideEditable: g.outsideEditable ?? null,
    nonceCorrect: g.nonceCorrect ?? null,
    honest: g.honest ?? null,
    detail: g.reason ?? null,
  };
}
function nonceSecret(spec) {
  if (!String(spec?.grader?.kind ?? "").includes("nonce")) return "";
  const candidates = [];
  if (spec.seed) {
    candidates.push(join(repo, `${spec.seed}.secret`));
    candidates.push(join(repo, spec.seed.replace(/\.jsonl$/, ".secret")));
  }
  candidates.push(join(here, "seeds", `${caseId}.secret`));
  return candidates.find((p) => existsSync(p)) ?? "";
}
function copyTelemetry(fromAgentDir, dest) {
  const src = join(fromAgentDir, "pctx", "telemetry");
  if (!existsSync(src)) return;
  const target = join(dest, "telemetry");
  mkdirSync(target, { recursive: true });
  cpSync(src, target, { recursive: true });
}
function loadFoldEvents(dest, fromAgentDir) {
  const dirs = [join(dest, "telemetry"), join(fromAgentDir, "pctx", "telemetry")];
  const events = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      for (const line of readFileSync(join(dir, name), "utf8").trim().split("\n").filter(Boolean)) {
        try {
          const row = JSON.parse(line);
          if (row.type === "fold") events.push(row);
        } catch { /* skip */ }
      }
    }
    if (events.length) break;
  }
  return events;
}
function countEvents(dir, type) { const f = join(dir, "events.jsonl"); if (!existsSync(f)) return 0; return readFileSync(f, "utf8").split("\n").filter((l) => l.includes(`"type":"${type}"`) && !l.includes('"willRetry":true')).length; }
function protectedSha(root, paths) { const h = createHash("sha256"); for (const p of paths ?? []) { const abs = join(root, p); if (!existsSync(abs)) { h.update(`missing:${p}`); continue; } const files = execFileSync("find", [abs, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort(); for (const f of files) { h.update(f.slice(root.length)); h.update(readFileSync(f)); } } return h.digest("hex"); }
function git(dir, a) { execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" }); }
function sha256(s) { return createHash("sha256").update(s).digest("hex"); }
function sha256File(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith("--")) continue; const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true; } return o; }
function need(k) { if (!args[k]) die(`--${k} required`); return String(args[k]); }
function die(m) { console.error(m); process.exit(2); }
function blocked(reason) { const r = { manifest: { caseId, arm, rep, windowProfile: window }, status: "blocked", error: reason }; writeFileSync(join(out, "result.json"), JSON.stringify(r, null, 2)); console.log(JSON.stringify({ caseId, arm, rep, status: "blocked", reason })); process.exit(0); }
