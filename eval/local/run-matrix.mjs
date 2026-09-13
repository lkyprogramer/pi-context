#!/usr/bin/env node
/**
 * Run the frozen scenario matrix serially against the 4090 production model.
 *
 *   node run-matrix.mjs --out artifacts/local-eval/<runId> [--mode controlled|live] [--config review-matrix.json]
 *                        [--only L01,H01] [--dry] [--resume <runDir>] [--seed 42]
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
import { plannedEpisodeId } from "./accounting.mjs";
import { hashTree, sha256Bytes } from "./bundle.mjs";
import { firstAttemptRecallHit, parseSession, semanticQuote, verbatimQuote } from "./parse-session.mjs";
import { REVIEW_BUDGET, requiresFoldMap } from "./review-spec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
loadRepoEnv(repo);
const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode ?? "live");
if (mode !== "live" && mode !== "controlled") die("--mode must be controlled|live");
const runDir = resolve(args.resume ?? args.out ?? die("--out required"));
const dry = "dry" in args;
if (mode === "live" && process.env.PCTX_LIVE !== "1" && !dry) {
  die("live mode requires PCTX_LIVE=1 and the user-provided endpoint; refusing to search other providers");
}
mkdirSync(runDir, { recursive: true });

let reviewCfg = null;
if (args.config) {
  reviewCfg = JSON.parse(readFileSync(resolve(String(args.config)), "utf8"));
  writeFileSync(join(runDir, "plan.json"), JSON.stringify(reviewCfg, null, 2));
}
const isReviewLive = Boolean(reviewCfg?.qualityIds?.includes("Q01"));
const CONTROLLED_TESTS = [
  "test/host/after-fold-quality.test.ts",
  "test/host/balanced-wire.test.ts",
  "test/host/controlled-guards.test.ts",
  "test/host/warm-fold-regime.test.ts",
];
if (mode === "controlled") {
  const r = spawnSync("pnpm", ["exec", "vitest", "run", ...CONTROLLED_TESTS, "--config", "vitest.config.ts"], {
    cwd: repo, encoding: "utf8", stdio: "inherit",
  });
  writeFileSync(join(runDir, "controlled.json"), JSON.stringify({
    mode: "controlled",
    exit: r.status,
    liveStatus: "UNRUN",
    liveDenominator: 84,
    guardIds: reviewCfg?.guardIds ?? ["G01", "G02"],
    tests: CONTROLLED_TESTS,
    note: "host-controlled fold + G01/G02 + W-lane regime; live 84-episode matrix is a separate --mode live run",
  }, null, 2));
  process.exit(r.status ?? 1);
}
const allCases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
const casesById = new Map(allCases.map((c) => [c.id, c]));
const only = args.only ? String(args.only).split(",") : null;
const selected = allCases.filter((c) => {
  if (only && !only.includes(c.id)) return false;
  if (isReviewLive) return reviewCfg.order.some((o) => o.caseId === c.id);
  return c.runner === "episode";
});

let manifest;
const manifestPath = join(runDir, "manifest.json");
if (args.resume && existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} else {
  const seed = Number(args.seed ?? 42);
  let order = [];
  if (isReviewLive) {
    order = reviewCfg.order
      .filter((o) => !only || only.includes(o.caseId))
      .map((o) => ({
        ...o,
        windowProfile: casesById.get(o.caseId)?.windowProfile ?? "w64k",
        sandbox: true,
      }));
  } else {
    for (const c of selected) {
      for (let rep = 1; rep <= c.reps; rep++) {
        const arms = rep % 2 === 1 ? c.arms : [...c.arms].reverse();
        for (const arm of arms) {
          const episodeId = plannedEpisodeId(runDir.split("/").pop(), c.id, arm, rep);
          order.push({ episodeId, caseId: c.id, arm, rep, windowProfile: c.windowProfile, sandbox: true });
        }
      }
    }
    shuffleGroups(order, seed);
  }
  const dist = join(repo, "dist/extension.js");
  const tarball = findTarball();
  const endpoint = modelEndpoint();
  const qualityIds = isReviewLive
    ? reviewCfg.qualityIds.filter((id) => order.some((o) => o.caseId === id))
    : selected.filter((c) => String(c.id).startsWith("L")).map((c) => c.id);
  const capabilityIds = isReviewLive
    ? reviewCfg.capabilityIds.filter((id) => order.some((o) => o.caseId === id))
    : selected.filter((c) => String(c.id).startsWith("H")).map((c) => c.id);
  const expectedPairs = isReviewLive
    ? new Set(order.filter((o) => qualityIds.includes(o.caseId)).map((o) => `${o.caseId}:${o.rep}`)).size
    : qualityIds.reduce((n, id) => {
      const c = selected.find((x) => x.id === id);
      return n + (c ? c.reps : 0);
    }, 0);
  const expectedCapabilities = isReviewLive
    ? order.filter((o) => capabilityIds.includes(o.caseId)).length
    : capabilityIds.reduce((n, id) => {
      const c = selected.find((x) => x.id === id);
      return n + (c ? c.reps * (c.arms.includes("balanced") ? 1 : 0) : 0);
    }, 0);
  const porcelain = sh("git", ["status", "--porcelain"]);
  if (mode === "live" && porcelain.length > 0 && !("allow-dirty" in args) && !dry) {
    die("live run refused: working tree dirty; use --allow-dirty for a diagnostic-only run");
  }
  const distFiles = hashTree(join(repo, "dist"));
  const distDigest = sha256Bytes(JSON.stringify(Object.entries(distFiles).sort(([a], [b]) => a.localeCompare(b))));
  const diagnosticOnly = mode === "live" && porcelain.length > 0;
  const reviewPlan = isReviewLive ? reviewCfg : null;
  manifest = {
    runId: runDir.split("/").pop(), createdAt: new Date().toISOString(), seed,
    git: { head: sh("git", ["rev-parse", "HEAD"]), tree: sh("git", ["rev-parse", "HEAD^{tree}"]), dirty: porcelain.length > 0 },
    dirtyDigest: porcelain ? sha256Bytes(porcelain) : null,
    diagnosticOnly,
    hostVersion: piVersion(),
    pluginSha256: existsSync(dist) ? sha256File(dist) : null,
    distFiles,
    distDigest,
    piPackageHash: existsSync(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json"))
      ? sha256File(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json"))
      : null,
    tarballSha256: tarball.sha256,
    tarball: tarball.path,
    sandboxImage: process.env.PCTX_SANDBOX_IMAGE ?? "pctx-t21-sandbox:0.85.1",
    sandboxImageId: imageId(),
    model: endpoint.expectModel, baseUrl: endpoint.baseUrl, thinking: "medium",
    models: modelsSnapshot(),
    budget: isReviewLive
      ? {
        totalEpisodes: order.length,
        totalWallMs: REVIEW_BUDGET.run.totalWallMs,
        totalModelCalls: REVIEW_BUDGET.run.totalModelCalls,
        totalToolCalls: REVIEW_BUDGET.run.totalToolCalls,
        episode: { ...REVIEW_BUDGET.episode },
        episodeLong: { ...(REVIEW_BUDGET.episodeLong ?? { wallMs: 900_000, modelCalls: 40, toolCalls: 80 }) },
      }
      : { totalEpisodes: order.length, totalWallMs: 3.5 * 3600 * 1000, episode: { wallMs: 900000, modelCalls: 40, toolCalls: 80 }, h03: { wallMs: 3600000, modelCalls: 200, toolCalls: 400 } },
    configHash: null,
    configHashByArm: await expectedArmHashes(),
    metricsAvailable: metricsAvailable(),
    order,
    plan: reviewPlan ? {
      ...reviewPlan,
      qualityIds,
      capabilityIds,
      expectedPairs: reviewPlan.expectedPairs ?? expectedPairs,
      expectedCapabilities: reviewPlan.expectedCapabilities ?? expectedCapabilities,
      requiresFold: reviewPlan.requiresFold ?? requiresFoldMap([...qualityIds, ...capabilityIds, ...(reviewPlan.regimeLanes?.warm?.ids ?? []), ...(reviewPlan.regimeLanes?.long?.ids ?? [])]),
      objective: reviewPlan.objective ?? {
        primary: { metric: "fresh-input", minImprovement: 0.1 },
        secondary: ["logical-input", "wall-time", "cacheRead", "engine-prefill", "native-compactions", "requests"],
      },
      scenarioHash: sha256File(resolve(String(args.config))),
      order,
    } : {
      qualityIds,
      capabilityIds,
      requiresFold: Object.fromEntries(capabilityIds.map((id) => [id, true])),
      objective: {
        primary: { metric: "fresh-input", minImprovement: 0.1 },
        secondary: ["logical-input", "wall-time", "cacheRead", "engine-prefill", "native-compactions", "requests"],
      },
      expectedPairs,
      expectedCapabilities,
      scenarioHash: sha256File(join(here, "cases.json")),
      order,
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

if (dry) { console.log(JSON.stringify({ runDir, episodes: manifest.order.length, order: manifest.order.map((o) => `${o.caseId}/${o.arm}/${o.rep}`) }, null, 2)); process.exit(0); }
if (!manifest.pluginSha256 && manifest.order.some((o) => o.arm !== "native")) die("dist/extension.js missing; run pnpm build");

const started = Date.now();
let blockedCount = 0, done = 0, usedModel = 0, usedTools = 0;
for (const ep of manifest.order) {
  if (Date.now() - started > manifest.budget.totalWallMs) { console.error("total wall budget exhausted; stopping"); break; }
  if (manifest.budget.totalModelCalls != null && usedModel >= manifest.budget.totalModelCalls) { console.error("total model budget exhausted; stopping"); break; }
  if (manifest.budget.totalToolCalls != null && usedTools >= manifest.budget.totalToolCalls) { console.error("total tool budget exhausted; stopping"); break; }
  const epDir = join(runDir, "episodes", `${ep.caseId}-${ep.arm}-r${ep.rep}`);
  if (existsSync(join(epDir, "result.json"))) { console.log(`skip existing ${epDir}`); continue; }
  mkdirSync(epDir, { recursive: true });
  const live = modelsSnapshot();
  if (!engineOk(live)) {
    const result = { manifest: ep, episodeId: ep.episodeId, status: "blocked", error: `engine-changed ${JSON.stringify(live?.data?.[0] ?? live)}` };
    writeFileSync(join(epDir, "result.json"), JSON.stringify(result, null, 2));
    appendFileSync(join(runDir, "episodes.jsonl"), `${JSON.stringify(result)}\n`);
    appendFileSync(join(runDir, "attempts.jsonl"), `${JSON.stringify({ episodeId: ep.episodeId, attemptId: `${ep.episodeId}:a1`, status: "blocked", requests: [] })}\n`);
    blockedCount++; done++;
    continue;
  }
  const cmd = ["run-episode.mjs", "--case", ep.caseId, "--arm", ep.arm, "--window", ep.windowProfile ?? "w64k", "--rep", String(ep.rep), "--out", epDir, "--run", manifest.runId, "--episode-id", ep.episodeId];
  const specBudget = casesById.get(ep.caseId)?.budget === "episodeLong" || ep.caseId === "X01" || ep.lane === "X";
  if (isReviewLive && manifest.budget.episode) {
    const epBudget = specBudget ? (manifest.budget.episodeLong ?? REVIEW_BUDGET.episodeLong ?? manifest.budget.episode) : manifest.budget.episode;
    cmd.push("--budget-wall-ms", String(epBudget.wallMs), "--budget-model", String(epBudget.modelCalls), "--budget-tools", String(epBudget.toolCalls));
  }
  const r = spawnSync("node", cmd.map((x, i) => (i === 0 ? join(here, x) : x)), { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  const resultPath = join(epDir, "result.json");
  if (!existsSync(resultPath)) { appendFileSync(join(runDir, "episodes.jsonl"), `${JSON.stringify({ manifest: ep, status: "error", error: `runner exit ${r.status}` })}\n`); continue; }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const spec = casesById.get(ep.caseId);
  if (result.status !== "blocked" && ep.caseId !== "H03" && result.oracle?.passed == null) {
    const secret = spec.seed ? join(repo, `${spec.seed}.secret`) : "";
    spawnSync("bash", [join(here, "grade.sh"), ep.caseId, result.workdir, epDir, secret], { stdio: "ignore" });
    if (existsSync(join(epDir, "grade.json"))) {
      const g = JSON.parse(readFileSync(join(epDir, "grade.json"), "utf8"));
      result.oracle = { passed: g.passed, exitCode: g.exitCode, protectedIntact: g.protectedIntact, outsideEditable: g.outsideEditable ?? null, nonceCorrect: g.nonceCorrect ?? null, honest: g.honest ?? null, detail: g.reason };
    }
  }
  const sessionFile = join(epDir, "session", "session.jsonl");
  if ((spec?.evidence?.kind === "verbatim-quote" || spec?.evidence?.kind === "recall-line") && existsSync(sessionFile)) {
    const parsed = parseSession(sessionFile);
    const sinceMs = new Date(result.manifest?.startedAt ?? 0).getTime();
    const verbatim = spec.evidence.linePattern
      ? verbatimQuote(parsed, { linePattern: spec.evidence.linePattern, sinceMs, sourceKind: spec.evidence.sourceKind ?? "isError" })
      : null;
    const semantic = spec.evidence.semanticToken
      ? semanticQuote(parsed, { token: spec.evidence.semanticToken, sinceMs })
      : verbatim;
    result.oracle = { ...(result.oracle ?? {}) };
    if ((spec.evidence.quoteMode ?? "verbatim") === "semantic") result.oracle.quotedSemantic = semantic;
    else {
      result.oracle.quotedVerbatim = verbatim;
      result.oracle.quotedSemantic = semantic;
    }
    if (spec.evidence.kind === "recall-line") {
      result.oracle.firstAttemptRecallHit = firstAttemptRecallHit(parsed, spec.evidence.linePattern);
    }
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
  if (existsSync(join(epDir, "attempts.jsonl"))) {
    appendFileSync(join(runDir, "attempts.jsonl"), readFileSync(join(epDir, "attempts.jsonl"), "utf8"));
  }
  for (const q of result.requests ?? []) appendFileSync(join(runDir, "requests.jsonl"), `${JSON.stringify({ caseId: ep.caseId, arm: ep.arm, rep: ep.rep, requestId: q.requestId, source: q.source, usage: q.usage, purpose: q.purpose })}\n`);
  usedModel += result.requests?.length ?? 0;
  const csPath = join(epDir, "container-status.json");
  if (existsSync(csPath)) usedTools += JSON.parse(readFileSync(csPath, "utf8")).toolCalls ?? 0;
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
    const { metricsUrl, apiKey } = modelEndpoint();
    const args = ["-fsS", "--max-time", "8", metricsUrl];
    if (apiKey) args.splice(1, 0, "-H", `Authorization: Bearer ${apiKey}`);
    const r = execFileSync("curl", args, { encoding: "utf8" });
    return /prefix_cache_hit_tokens_total|prompt_tokens_total|ninfer:requests_total/.test(r);
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
