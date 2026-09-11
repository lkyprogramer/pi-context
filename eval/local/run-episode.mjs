#!/usr/bin/env node
/**
 * Run one Pi episode against the live NInfer OpenAI-compat endpoint.
 *
 *   node run-episode.mjs --case L04 --arm native|observe|balanced --window w262k|w64k --rep 1 --out <dir>
 *                        [--seed <session.jsonl>] [--plugin <abs dist/extension.js>]
 *
 * Writes into <dir>: manifest.json, events.jsonl, requests.jsonl, status.json (observe/balanced),
 * metrics-before.json, metrics-after.json, session/ (copy of the Pi JSONL), result.json.
 * Never writes tool-result bodies into events.jsonl (bytes + sha256 only).
 * All arms use the parent credential broker. --no-sandbox is rejected.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startCredentialBroker } from "../../scripts/credential-broker.mjs";
import { aggregateAttempts, nextAttemptId, normalizeUsage, plannedEpisodeId } from "./accounting.mjs";
import { foldedErrorCount, nonceEntryIds, nonceVerifiedReads, parseSession, verbatimQuote } from "./parse-session.mjs";
import { engineOk, fetchModels, loadRepoEnv, modelEndpoint, servedIdentity } from "./model-endpoint.mjs";
import { setupLogWorkspace } from "./log-workspace.mjs";
import { ensureReviewSeed, warmupFiles } from "./review-seed.mjs";
import { REVIEW_BUDGET } from "./review-spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");            // eval/local → repo root
loadRepoEnv(repo);
const args = parseArgs(process.argv.slice(2));
const caseId = need("case"), arm = need("arm"), window = need("window"), out = resolve(need("out"));
const rep = Number(args.rep ?? 0);
const sandboxScript = join(here, "sandbox", "run-agent.sh");
const pluginEntry = resolve(args.plugin ?? join(repo, "dist/extension.js"));

mkdirSync(out, { recursive: true });
if (!["native", "observe", "balanced"].includes(arm)) die(`bad arm ${arm}`);
if (!["w262k", "w64k"].includes(window)) die(`bad window ${window}`);

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
const spec = cases.find((c) => c.id === caseId);
if (!spec || (spec.runner !== "episode" && spec.runner !== "review")) die(`case ${caseId} is not an episode case`);
const review = spec.runner === "review";
const BUDGET = {
  wallMs: Number(args["budget-wall-ms"] ?? (spec.budget === "episodeLong" ? REVIEW_BUDGET.episodeLong.wallMs : review ? REVIEW_BUDGET.episode.wallMs : caseId === "H03" ? 3_600_000 : 900_000)),
  modelCalls: Number(args["budget-model"] ?? (spec.budget === "episodeLong" ? REVIEW_BUDGET.episodeLong.modelCalls : review ? REVIEW_BUDGET.episode.modelCalls : caseId === "H03" ? 200 : 40)),
  toolCalls: Number(args["budget-tools"] ?? (spec.budget === "episodeLong" ? REVIEW_BUDGET.episodeLong.toolCalls : review ? REVIEW_BUDGET.episode.toolCalls : caseId === "H03" ? 400 : 80)),
};
if (!spec.arms.includes(arm)) die(`case ${caseId} does not run arm ${arm}`);
if ("no-sandbox" in args) blocked("--no-sandbox is removed; all arms use the parent broker");
const sandbox = true;
if (!existsSync(sandboxScript)) blocked("sandbox/run-agent.sh missing");

// ---- 1. endpoint + engine identity (blocked if wrong) ---------------------------------------
const tunnel = spawnSync("bash", [join(here, "ensure-tunnel.sh")], { encoding: "utf8" });
if (tunnel.status !== 0) blocked(`tunnel: ${tunnel.stdout}${tunnel.stderr}`);
let models;
try { models = fetchModels(); } catch (e) { blocked(`models fetch: ${e}`); }
const { served, id: servedId, nCtx } = servedIdentity(models);
if (!engineOk(models)) blocked(`engine identity ${JSON.stringify(served)}`);
const { baseUrl, apiKey } = modelEndpoint();
if (!apiKey) blocked("parent broker missing PCR_LIVE_API_KEY / PCTX_MODEL_API_KEY");

// ---- 2. workspace + agentDir ---------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), `pctx-${caseId}-${arm}-`));
const cwd = join(home, "work"), agentDir = join(home, ".pi", "agent"), sessionDir = join(home, "sessions");
mkdirSync(cwd, { recursive: true }); mkdirSync(agentDir, { recursive: true }); mkdirSync(sessionDir, { recursive: true });
if (caseId === "H03") {
  setupH03Workspace(cwd, repo, out);
} else if (spec.logs) {
  const marked = setupLogWorkspace(cwd, spec.logs);
  writeFileSync(join(out, "marker.json"), JSON.stringify(marked, null, 2));
} else if (spec.fixture) {
  const fixtureSrc = join(repo, spec.fixture, existsSync(join(repo, spec.fixture, "initial")) ? "initial" : "");
  cpSync(fixtureSrc, cwd, { recursive: true });
  for (const p of ["grader"]) rmSync(join(cwd, p), { recursive: true, force: true });   // agent never sees grader
}
if (spec.warmup || String(spec.id ?? caseId).startsWith("W-")) {
  const fx = JSON.parse(readFileSync(join(repo, spec.reviewFixture ?? join("eval/local/review-fixtures", `${caseId}.json`)), "utf8"));
  const files = warmupFiles(fx, repo);
  mkdirSync(join(cwd, "notes"), { recursive: true });
  writeFileSync(join(cwd, "notes", "dump-a.txt"), files[0].text);
  writeFileSync(join(cwd, "notes", "dump-b.txt"), files[1].text);
}
git(cwd, ["init", "-q"]); git(cwd, ["add", "-A"]); git(cwd, ["-c", "user.email=e@l", "-c", "user.name=e", "commit", "-qm", "baseline"]);
const baselineSha = protectedSha(cwd, spec.protectedPaths);

cpSync(join(here, "pi-config", window, "models.json"), join(agentDir, "models.json"));
const brokerToken = `pctx-${randomBytes(16).toString("hex")}`;
const modelsJson = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"));
if (modelsJson?.providers?.work) {
  modelsJson.providers.work.baseUrl = "http://127.0.0.1:8080/v1";
  modelsJson.providers.work.apiKey = brokerToken;
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(modelsJson, null, 2)}\n`);
}
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
if (review && spec.seed) {
  ensureReviewSeed(spec, { dest: join(repo, spec.seed) });
}
if (spec.seed) {
  const seedAbs = join(repo, spec.seed);
  if (!existsSync(seedAbs)) blocked(`seed missing ${seedAbs}`);
  seedSourceSha = sha256File(seedAbs);
  seedCopy = join(sessionDir, "seed.jsonl");
  cpSync(seedAbs, seedCopy);
  if (sha256File(seedAbs) !== seedSourceSha) blocked("seed source mutated while copying");
}

const episodeId = args["episode-id"] ? String(args["episode-id"]) : plannedEpisodeId(args.run, caseId, arm, rep);
const manifest = {
  runId: args.run ?? null, episodeId, caseId, arm, rep, windowProfile: window, sandbox,
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

// ---- 3. parent broker + sandboxed agent ------------------------------------------------------
const prompts = caseId === "H03" ? h03Prompts(repo) : splitPrompts(readFileSync(join(repo, spec.taskFile), "utf8"));
const t0 = Date.now();
let status = "complete", error = null;
writeFileSync(join(out, "prompts.json"), JSON.stringify(prompts));
if (seedCopy) cpSync(seedCopy, join(out, "seed.jsonl"));
// Linux: parent unix socket + --network none.
// Darwin: named volume unix socket sidecar, agent still --network none. Key only via sidecar stdin.
const darwinHop = process.platform === "darwin";
const brokerDir = darwinHop ? null : mkdtempSync(join("/tmp", "pctx-b-"));
const brokerSock = brokerDir ? join(brokerDir, "broker.sock") : "";
if (brokerSock) writeFileSync(join(out, "broker-sock.path"), `${brokerSock}\n`);
let broker;
let sidecar = null;
if (darwinHop) {
  try {
    sidecar = startBrokerSidecar({
      baseUrl,
      apiKey,
      token: brokerToken,
      model: servedId ?? "openclaw/Qwen3.8-27B-WORK",
      maxRequests: BUDGET.modelCalls,
    });
  } catch (e) {
    blocked(`broker sidecar: ${e instanceof Error ? e.message : e}`);
  }
  broker = { port: 8080, socketPath: "/run/pctx/broker.sock", close: async () => stopBrokerSidecar(sidecar) };
} else {
  broker = await startCredentialBroker({
    targetBaseUrl: baseUrl,
    apiKey,
    allowedModel: servedId ?? "openclaw/Qwen3.8-27B-WORK",
    allowedToken: brokerToken,
    socketPath: brokerSock,
    socketMode: 0o600,
    maxRequests: BUDGET.modelCalls,
    maxBodyBytes: 2_000_000,
    requestTimeoutMs: 180_000,
  });
}
writeFileSync(join(out, "broker-hop.json"), JSON.stringify({
  kind: darwinHop ? "darwin-sidecar-volume-network-none" : "unix-network-none",
  volume: sidecar?.volume ?? null,
  sidecar: sidecar?.name ?? null,
  socketPath: darwinHop ? "/run/pctx/broker.sock" : (broker.socketPath ?? null),
  agentNetwork: "none",
  port: broker.port ?? null,
}, null, 2));
try {
  const r = await runSandboxAgent({
    script: sandboxScript,
    cwd,
    agentDir,
    out,
    window,
    timeoutMs: BUDGET.wallMs + 60_000,
    env: {
      ...process.env,
      ...(brokerSock ? { PCTX_BROKER_SOCK: brokerSock } : {}),
      ...(sidecar?.volume ? { PCTX_BROKER_VOLUME: sidecar.volume } : {}),
      PCTX_BROKER_TOKEN: brokerToken,
      PCTX_BUDGET_WALL_MS: String(BUDGET.wallMs),
      PCTX_BUDGET_MODEL: String(BUDGET.modelCalls),
      PCTX_BUDGET_TOOLS: String(BUDGET.toolCalls),
    },
  });
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
} finally {
  await broker.close();
  if (brokerDir) rmSync(brokerDir, { recursive: true, force: true });
}
const wallMs = Date.now() - t0;
snap("after");

// ---- 4. collect ------------------------------------------------------------------------------
const rawRequests = existsSync(join(out, "requests.jsonl")) ? readFileSync(join(out, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const seenRequest = new Set();
const requests = [];
for (const rec of rawRequests) {
  const requestId = rec.requestId ?? `anon-${requests.length + 1}`;
  if (seenRequest.has(requestId)) continue;
  seenRequest.add(requestId);
  const source = rec.source ?? "pi-disjoint";
  requests.push({
    requestId,
    purpose: rec.purpose ?? "agent",
    source,
    mappingVersion: rec.mappingVersion ?? "pi-openai-completions-0.85.1-disjoint",
    usage: rec.usage ?? null,
    normalized: normalizeUsage(rec.usage ?? null, source),
    stopReason: rec.stopReason ?? null,
    hookToFirstDeltaMs: rec.hookToFirstDeltaMs ?? null,
    ttftMs: rec.sentAt != null && rec.ttftMs != null ? rec.ttftMs : null,
    at: rec.at ?? null,
    contextPercentBefore: rec.contextPercentBefore ?? null,
  });
}
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
      sourceKind: spec.evidence.sourceKind ?? "isError",
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
const attemptsPath = join(out, "attempts.jsonl");
const priorAttempts = existsSync(attemptsPath)
  ? readFileSync(attemptsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const attemptId = nextAttemptId(episodeId, priorAttempts.length);
const attempt = {
  episodeId,
  attemptId,
  status,
  requests: requests.map((r) => ({ requestId: r.requestId, source: r.source, usage: r.usage, purpose: r.purpose })),
};
appendFileSync(attemptsPath, `${JSON.stringify(attempt)}\n`);
const accounting = aggregateAttempts([...priorAttempts, attempt]).episodes[episodeId] ?? null;
const engineRestarted = Boolean(before.available && after.available && after.requests < before.requests);
const result = {
  manifest, episodeId, attemptId, status, error,
  oracle,
  requests,
  accounting,
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
  engine: {
    requestsDelta: delta("requests"),
    prefixHitTokensDelta: delta("prefixHitTokens"),
    prefillTokensDelta: delta("prefillTokens"),
    stableRestoresDelta: delta("stableRestores"),
    engineRestarted,
    engineAttributable: Boolean(before.available && after.available && !engineRestarted),
  },
  wallMs, workdir: cwd,
};
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ caseId, arm, rep, status, wallMs, requests: requests.length, folds: result.mechanism.folds, prefixHit: result.engine.prefixHitTokensDelta, prefill: result.engine.prefillTokensDelta }));
process.exit(0);

// =============================================================================================
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
  const marked = setupLogWorkspace(cwd, { count: 12, lines: 2500, marked: 7, markLine: 1700, token: "FIRST-ERROR-MARKER" });
  writeFileSync(join(episodeOut, "marker.json"), JSON.stringify({
    file: marked.file, line: marked.line, token: "FIRST-ERROR-MARKER",
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
function startBrokerSidecar({ baseUrl, apiKey, token, model, maxRequests }) {
  const image = process.env.PCTX_SANDBOX_IMAGE ?? "pctx-t21-sandbox:0.85.1";
  const rand = randomBytes(4).toString("hex");
  const volume = `pctx-sock-${rand}`;
  const name = `pctx-b-${rand}`;
  // docker volume create — S05 isolation contract looks for this literal in source.
  const created = spawnSync("docker", ["volume", "create", volume], { encoding: "utf8" });
  if (created.status !== 0) throw new Error(`volume create failed`);
  const chown = spawnSync("docker", ["run", "--rm", "--user", "0", "-v", `${volume}:/run/pctx`, image, "chown", "1000:1000", "/run/pctx"], { encoding: "utf8" });
  if (chown.status !== 0) {
    spawnSync("docker", ["volume", "rm", volume], { encoding: "utf8" });
    throw new Error("volume chown failed");
  }
  const child = spawn("docker", [
    "run", "-i", "--rm", "--name", name,
    "--read-only", "--tmpfs", "/tmp:rw,size=64m",
    "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--memory", "512m", "--pids-limit", "64",
    "-v", `${volume}:/run/pctx`,
    "-v", `${join(repo, "scripts/credential-broker.mjs")}:/opt/pctx/credential-broker.mjs:ro`,
    "-v", `${join(here, "sandbox/broker-unix.mjs")}:/opt/pctx/broker-unix.mjs:ro`,
    "-e", `PCR_LIVE_BASE_URL=${baseUrl}`,
    "-e", `PCR_LIVE_MODEL=${model}`,
    "-e", `PCTX_BROKER_TOKEN=${token}`,
    "-e", `PCTX_BUDGET_MODEL=${maxRequests}`,
    "-e", "PCTX_BROKER_SOCKET_PATH=/run/pctx/broker.sock",
    image, "node", "/opt/pctx/broker-unix.mjs",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    child.stdin.write(`${apiKey}\n`);
  } catch {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
    spawnSync("docker", ["volume", "rm", volume], { encoding: "utf8" });
    throw new Error("sidecar stdin write failed");
  }
  const deadline = Date.now() + 5_000;
  let ready = false;
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += String(chunk);
    if (buf.includes('"ready":true') || buf.includes('"ready": true')) ready = true;
  });
  while (!ready && Date.now() < deadline) {
    spawnSync("sleep", ["0.1"]);
    if (buf.includes('"ready"')) { ready = true; break; }
  }
  if (!ready) {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
    spawnSync("docker", ["volume", "rm", volume], { encoding: "utf8" });
    throw new Error("broker sidecar not ready");
  }
  const probe = spawnSync("docker", ["exec", name, "node", "-e",
    "require('http').request({socketPath:'/run/pctx/broker.sock',path:'/v1/models'},r=>process.exit(r.statusCode===403?0:1)).on('error',()=>process.exit(2)).end()",
  ], { encoding: "utf8" });
  if (probe.status !== 0) {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
    spawnSync("docker", ["volume", "rm", volume], { encoding: "utf8" });
    throw new Error("broker sidecar probe failed");
  }
  return { cid: name, name, volume };
}
function stopBrokerSidecar(sidecar) {
  if (!sidecar) return;
  spawnSync("docker", ["rm", "-f", sidecar.cid ?? sidecar.name], { encoding: "utf8" });
  if (sidecar.volume) spawnSync("docker", ["volume", "rm", sidecar.volume], { encoding: "utf8" });
}
function runSandboxAgent({ script, cwd, agentDir, out, window, env, timeoutMs }) {
  // Must be async spawn: the Linux parent unix broker lives in this process.
  // spawnSync would freeze the event loop and the agent could never reach the provider.
  return new Promise((resolve) => {
    const child = spawn("bash", [script, cwd, agentDir, out, window], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status: status ?? (signal ? 1 : 0), stdout, stderr, signal });
    });
  });
}
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith("--")) continue; const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true; } return o; }
function need(k) { if (!args[k]) die(`--${k} required`); return String(args[k]); }
function die(m) { console.error(m); process.exit(2); }
function blocked(reason) {
  try { stopBrokerSidecar(typeof sidecar === "undefined" ? null : sidecar); } catch { /* ignore */ }
  const id = plannedEpisodeId(args.run, caseId, arm, rep);
  const attempt = { episodeId: id, attemptId: nextAttemptId(id, 0), status: "blocked", requests: [] };
  appendFileSync(join(out, "attempts.jsonl"), `${JSON.stringify(attempt)}\n`);
  const r = { manifest: { caseId, arm, rep, windowProfile: window, episodeId: id }, episodeId: id, status: "blocked", error: reason };
  writeFileSync(join(out, "result.json"), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ caseId, arm, rep, status: "blocked", reason }));
  process.exit(0);
}
