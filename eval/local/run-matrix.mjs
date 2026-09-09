#!/usr/bin/env node
/**
 * Run the frozen scenario matrix serially against the 4090 production model.
 *
 *   node run-matrix.mjs --out artifacts/local-eval/<runId> [--only L01,H01] [--dry] [--resume <runDir>] [--seed 42]
 *
 * Writes manifest.json (frozen identity + order + budget), episodes.jsonl (one EpisodeResult per line),
 * requests.jsonl (flattened), and per-episode directories. Never overwrites an existing episode directory.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertArm } from "./arm-contract.mjs";
import { engineOk, fetchModels, loadRepoEnv, modelEndpoint } from "./model-endpoint.mjs";
import { parseSession, verbatimQuote } from "./parse-session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
loadRepoEnv(repo);
const args = parseArgs(process.argv.slice(2));
const runDir = resolve(args.resume ?? args.out ?? die("--out required"));
const dry = "dry" in args;
mkdirSync(runDir, { recursive: true });

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases.filter((c) => c.runner === "episode");
const only = args.only ? String(args.only).split(",") : null;
const selected = cases.filter((c) => !only || only.includes(c.id));

let manifest;
const manifestPath = join(runDir, "manifest.json");
if (args.resume && existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} else {
  const seed = Number(args.seed ?? 42);
  const order = [];
  for (const c of selected) {
    for (let rep = 1; rep <= c.reps; rep++) {
      const arms = rep % 2 === 1 ? c.arms : [...c.arms].reverse();
      for (const arm of arms) order.push({ caseId: c.id, arm, rep, windowProfile: c.windowProfile, sandbox: c.sandbox !== false });
    }
  }
  shuffleGroups(order, seed);
  const dist = join(repo, "dist/extension.js");
  const tarball = findTarball();
  const endpoint = modelEndpoint();
  manifest = {
    runId: runDir.split("/").pop(), createdAt: new Date().toISOString(), seed,
    git: { head: sh("git", ["rev-parse", "HEAD"]), tree: sh("git", ["rev-parse", "HEAD^{tree}"]), dirty: sh("git", ["status", "--porcelain"]).length > 0 },
    hostVersion: piVersion(),
    pluginSha256: existsSync(dist) ? sha256File(dist) : null,
    tarballSha256: tarball.sha256,
    tarball: tarball.path,
    sandboxImage: process.env.PCTX_SANDBOX_IMAGE ?? "pctx-t21-sandbox:0.85.1",
    sandboxImageId: imageId(),
    model: endpoint.expectModel, baseUrl: endpoint.baseUrl, thinking: "medium",
    models: modelsSnapshot(),
    budget: { totalEpisodes: order.length, totalWallMs: 3.5 * 3600 * 1000, episode: { wallMs: 900000, modelCalls: 40, toolCalls: 80 }, h03: { wallMs: 3600000, modelCalls: 200, toolCalls: 400 } },
    configHash: null,
    configHashByArm: await expectedArmHashes(),
    metricsAvailable: metricsAvailable(),
    order,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

if (dry) { console.log(JSON.stringify({ runDir, episodes: manifest.order.length, order: manifest.order.map((o) => `${o.caseId}/${o.arm}/${o.rep}`) }, null, 2)); process.exit(0); }
if (!manifest.pluginSha256 && manifest.order.some((o) => o.arm !== "native")) die("dist/extension.js missing; run pnpm build");

const started = Date.now();
let blockedCount = 0, done = 0;
for (const ep of manifest.order) {
  if (Date.now() - started > manifest.budget.totalWallMs) { console.error("total wall budget exhausted; stopping"); break; }
  const epDir = join(runDir, "episodes", `${ep.caseId}-${ep.arm}-r${ep.rep}`);
  if (existsSync(join(epDir, "result.json"))) { console.log(`skip existing ${epDir}`); continue; }
  mkdirSync(epDir, { recursive: true });
  const live = modelsSnapshot();
  if (!engineOk(live)) {
    const result = { manifest: ep, status: "blocked", error: `engine-changed ${JSON.stringify(live?.data?.[0] ?? live)}` };
    writeFileSync(join(epDir, "result.json"), JSON.stringify(result, null, 2));
    appendFileSync(join(runDir, "episodes.jsonl"), `${JSON.stringify(result)}\n`);
    blockedCount++; done++;
    continue;
  }
  const cmd = ["run-episode.mjs", "--case", ep.caseId, "--arm", ep.arm, "--window", ep.windowProfile, "--rep", String(ep.rep), "--out", epDir, "--run", manifest.runId];
  if (!ep.sandbox) cmd.push("--no-sandbox");
  const r = spawnSync("node", cmd.map((x, i) => (i === 0 ? join(here, x) : x)), { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  const resultPath = join(epDir, "result.json");
  if (!existsSync(resultPath)) { appendFileSync(join(runDir, "episodes.jsonl"), `${JSON.stringify({ manifest: ep, status: "error", error: `runner exit ${r.status}` })}\n`); continue; }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const spec = cases.find((c) => c.id === ep.caseId);
  if (result.status !== "blocked" && ep.caseId !== "H03" && result.oracle?.passed == null) {
    const secret = spec.seed ? join(repo, `${spec.seed}.secret`) : "";
    spawnSync("bash", [join(here, "grade.sh"), ep.caseId, result.workdir, epDir, secret], { stdio: "ignore" });
    if (existsSync(join(epDir, "grade.json"))) {
      const g = JSON.parse(readFileSync(join(epDir, "grade.json"), "utf8"));
      result.oracle = { passed: g.passed, exitCode: g.exitCode, protectedIntact: g.protectedIntact, outsideEditable: g.outsideEditable ?? null, nonceCorrect: g.nonceCorrect ?? null, honest: g.honest ?? null, detail: g.reason };
    }
  }
  const sessionFile = join(epDir, "session", "session.jsonl");
  if (spec?.evidence?.kind === "verbatim-quote" && existsSync(sessionFile)) {
    const parsed = parseSession(sessionFile);
    result.oracle = { ...(result.oracle ?? {}), quotedVerbatim: verbatimQuote(parsed, { linePattern: spec.evidence.linePattern, sinceMs: new Date(result.manifest?.startedAt ?? 0).getTime() }) };
  }
  if (result.status !== "blocked") {
    const status = existsSync(join(epDir, "status.json")) ? JSON.parse(readFileSync(join(epDir, "status.json"), "utf8")) : null;
    const agentDir = result.workdir ? join(dirname(result.workdir), ".pi", "agent") : join(epDir, "missing-agent");
    let frozenHash = ep.arm === "native" ? null : (manifest.configHashByArm?.[ep.arm] ?? null);
    if (ep.arm !== "native" && !frozenHash && status?.configHash) {
      manifest.configHashByArm ??= {};
      manifest.configHashByArm[ep.arm] = status.configHash;
      frozenHash = status.configHash;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
    const verdict = assertArm({ ...ep, configHash: frozenHash, hostVersion: manifest.hostVersion }, status, agentDir);
    if (!verdict.ok) { result.status = "blocked"; result.error = `arm contract: ${verdict.reason}`; }
  }
  if (result.status === "blocked") blockedCount++;
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  appendFileSync(join(runDir, "episodes.jsonl"), `${JSON.stringify(result)}\n`);
  for (const q of result.requests ?? []) appendFileSync(join(runDir, "requests.jsonl"), `${JSON.stringify({ caseId: ep.caseId, arm: ep.arm, rep: ep.rep, ...q })}\n`);
  done++;
  console.log(`[${done}/${manifest.order.length}] ${ep.caseId}/${ep.arm}/r${ep.rep} → ${result.status} oracle=${result.oracle?.passed} folds=${result.mechanism?.folds} wall=${Math.round((result.wallMs ?? 0) / 1000)}s`);
}
console.log(JSON.stringify({ runDir, done, blockedCount, elapsedMs: Date.now() - started }));

function shuffleGroups(order, seed) {
  const groups = [...new Set(order.map((o) => o.caseId))];
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
  order.sort((a, b) => groups.indexOf(a.caseId) - groups.indexOf(b.caseId));
}
function sh(cmd, a) { try { return execFileSync(cmd, a, { cwd: repo, encoding: "utf8" }).trim(); } catch { return ""; } }
function sha256File(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--" || !a.startsWith("--")) continue; const k = a.slice(2); const v = argv[i + 1]; if (v && !v.startsWith("--")) { o[k] = v; i++; } else o[k] = true; } return o; }
function die(m) { console.error(m); process.exit(2); }
function piVersion() {
  try { return execFileSync("pi", ["--version"], { encoding: "utf8" }).trim(); }
  catch {
    const pkg = join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json");
    if (existsSync(pkg)) return String(JSON.parse(readFileSync(pkg, "utf8")).version ?? "unknown");
    return "";
  }
}
function imageId() {
  try {
    return execFileSync("docker", ["image", "inspect", process.env.PCTX_SANDBOX_IMAGE ?? "pctx-t21-sandbox:0.85.1", "--format", "{{.Id}}"], { encoding: "utf8" }).trim();
  } catch { return null; }
}
function findTarball() {
  const names = ["pi-context-6.1.0.tgz", "pi-context-5.0.0-dev.0.tgz", "pi-context.tgz"];
  for (const n of names) {
    const p = join(repo, n);
    if (existsSync(p)) return { path: n, sha256: sha256File(p) };
  }
  return { path: null, sha256: null };
}
function modelsSnapshot() {
  try { return fetchModels(); }
  catch { return null; }
}
function metricsAvailable() {
  try {
    const { baseUrl } = modelEndpoint();
    const r = execFileSync("curl", ["-fsS", "--max-time", "3", `${baseUrl.replace(/\/v1\/?$/, "")}/metrics`], { encoding: "utf8" });
    return /prefix_hit|prefill|n_ctx/.test(r);
  } catch {
    return false;
  }
}
async function expectedArmHashes() {
  const dist = join(repo, "dist/config.js");
  if (!existsSync(dist)) return {};
  const { parseConfig, configHashOf } = await import(pathToFileURL(dist).href);
  const telemetry = { includeContent: false, jsonl: true, maxLogBytes: 5_242_880 };
  return {
    observe: configHashOf(parseConfig({ schemaVersion: 6, profile: "observe", telemetry })),
    balanced: configHashOf(parseConfig({ schemaVersion: 6, profile: "balanced", telemetry })),
  };
}
