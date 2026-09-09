#!/usr/bin/env node
/**
 * Paired report + mechanical decision for a local-eval run.
 *   node report.mjs <runDir>            → writes <runDir>/report.md and report.json
 * Pure functions `summarize` and `decide` are exported for tests. Unknown usage is counted, never zeroed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { median } from "./accounting.mjs";
import { capabilitiesFromItt, evaluateTrial, materializeItt, pairsFromItt } from "./gate.mjs";

function usageOf(r) {
  return r.usage ?? r;
}

function cacheRatio(r) {
  const u = usageOf(r);
  if (u.input == null || u.cacheRead == null || u.input === 0) return null;
  return u.cacheRead / u.input;
}

/** Fold-aligned recovery: first post-fold request is the expected cache bust; the next 2 must be ≥ 0.5. */
export function cacheAfterFold(episode) {
  const reqs = (episode.requests ?? []).filter((r) => usageOf(r).input != null);
  const folds = episode.foldEvents ?? [];
  const points = [];
  if (folds.length) {
    for (const fold of folds) {
      const after = fold.at ? reqs.filter((r) => r.at && r.at >= fold.at) : [];
      points.push(recoveryFrom(after.length ? after : reqs));
    }
    return points;
  }
  const appliedAt = reqs.findIndex((r) => (r.replacementsApplied ?? 0) > 0);
  if (appliedAt >= 0) return [recoveryFrom(reqs.slice(appliedAt))];
  if ((episode.mechanism?.folds ?? 0) > 0) return [{ dipRatio: null, recovered: 0, unknown: true }];
  return [];
}

function recoveryFrom(seq) {
  if (!seq.length) return { dipRatio: null, recovered: 0, unknown: true };
  const dip = cacheRatio(seq[0]);
  const next = seq.slice(1, 3);
  if (next.length < 2) return { dipRatio: dip, recovered: next.filter((r) => (cacheRatio(r) ?? -1) >= 0.5).length, unknown: true };
  if (next.some((r) => cacheRatio(r) == null) || dip == null) return { dipRatio: dip, recovered: 0, unknown: true };
  return { dipRatio: dip, recovered: next.filter((r) => cacheRatio(r) >= 0.5).length, unknown: false };
}

export function summarize(episodes, priorAttempts = []) {
  const byCaseArm = {};
  const blocked = [];
  const flags = [];
  for (const e of episodes) {
    const { caseId, arm, rep } = e.manifest ?? {};
    if (e.status === "blocked") { blocked.push({ caseId, arm, rep, reason: e.error }); continue; }
    const cell = ((byCaseArm[caseId] ??= {})[arm] ??= {
      episodes: 0, passed: 0, failed: 0, timeout: 0, inputSum: 0, cacheReadSum: 0, outputSum: 0, unknownUsage: 0, requests: 0,
      walls: [],
      mech: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0, foldedErrorResults: 0, savedTokensEstimate: 0, invalidatedTokensEstimate: 0 },
      engine: { prefixHit: 0, prefill: 0, unknown: 0, prefixHitRatio: null },
      cacheAfterFold: [], nonce: { correct: 0, honest: 0 }, ttfts: [], wrongActions: 0, lostEvidence: 0, quotedVerbatimKnown: 0, requestCounts: [],
    });
    cell.episodes++;
    if (e.status === "timeout") cell.timeout++;
    if (e.oracle?.passed === true) cell.passed++; else if (e.oracle?.passed === false) cell.failed++;
    if (e.oracle?.nonceCorrect) cell.nonce.correct++; if (e.oracle?.honest) cell.nonce.honest++;
    if (e.oracle?.protectedIntact === false || (e.oracle?.outsideEditable ?? 0) > 0) cell.wrongActions++;
    if (typeof e.oracle?.quotedVerbatim === "boolean") { cell.quotedVerbatimKnown++; if (e.oracle.quotedVerbatim === false) cell.lostEvidence++; }
    if (typeof e.wallMs === "number") cell.walls.push(e.wallMs);
    cell.requestCounts.push((e.requests ?? []).length);
    for (const r of e.requests ?? []) {
      cell.requests++;
      if (typeof r.ttftMs === "number") cell.ttfts.push(r.ttftMs);
      const u = usageOf(r);
      if (u.input == null) { cell.unknownUsage++; continue; }
      cell.inputSum += u.input;
      if (u.cacheRead == null) cell.unknownUsage++;
      else cell.cacheReadSum += u.cacheRead;
      if (u.output != null) cell.outputSum += u.output;
    }
    for (const k of Object.keys(cell.mech)) cell.mech[k] += e.mechanism?.[k] ?? 0;
    if (e.engine?.prefixHitTokensDelta == null || e.engine?.prefillTokensDelta == null) cell.engine.unknown++;
    else { cell.engine.prefixHit += e.engine.prefixHitTokensDelta; cell.engine.prefill += e.engine.prefillTokensDelta; }
    if (e.engine?.engineRestarted) flags.push({ flag: "engine-restarted", caseId, arm, rep });
    cell.cacheAfterFold.push(...cacheAfterFold(e));
  }
  for (const [caseId, arms] of Object.entries(byCaseArm)) {
    const lengths = Object.values(arms).map((c) => c.requests);
    const positive = lengths.filter((n) => n > 0);
    if (positive.length >= 2) {
      const min = Math.min(...positive), max = Math.max(...positive);
      if (min > 0 && max > min * 3) flags.push({ flag: "trajectory-length-outlier", caseId, min, max });
    }
    for (const cell of Object.values(arms)) {
      const denom = cell.engine.prefixHit + cell.engine.prefill;
      cell.engine.prefixHitRatio = cell.engine.unknown === 0 && denom > 0 ? cell.engine.prefixHit / denom : null;
      cell.wallP50 = median(cell.walls);
      cell.ttftP50 = cell.ttfts.length ? median(cell.ttfts) : null;
      cell.cacheReadRatio = cell.inputSum > 0 && cell.unknownUsage === 0 && cell.cacheReadSum <= cell.inputSum
        ? cell.cacheReadSum / cell.inputSum
        : null;
      cell.uncachedInputSum = cell.unknownUsage === 0 && cell.cacheReadSum <= cell.inputSum
        ? cell.inputSum - cell.cacheReadSum
        : null;
    }
  }
  return {
    byCaseArm, blocked, blockedCount: blocked.length, total: episodes.length, flags, priorAttempts,
    cacheReadChannelAvailable: cacheChannelAvailable(episodes),
  };
}

export function cacheChannelAvailable(episodes) {
  let seen = false;
  for (const e of episodes ?? []) {
    for (const r of e.requests ?? []) {
      const cr = usageOf(r).cacheRead;
      if (cr == null) continue;
      seen = true;
      if (cr > 0) return true;
    }
  }
  return false;
}

export function candidates(summary, episodes = []) {
  const out = [];
  const h02 = summary.byCaseArm.H02 ?? {};
  const lost = Object.entries(h02).filter(([, c]) => c.lostEvidence > 0).map(([arm, c]) => `${arm} ${c.lostEvidence}/${c.quotedVerbatimKnown}`);
  if (lost.length) out.push({ candidate: "post-compaction-evidence-delta", evidence: lost });
  const hEps = episodes.filter((e) => ["H01", "H02"].includes(e.manifest?.caseId) && e.status !== "blocked");
  const searchedNoRef = hEps.filter((e) => ["observe", "balanced"].includes(e.manifest.arm) && (e.mechanism?.historySearches ?? 0) >= 1 && (e.mechanism?.verifiedReads ?? 0) === 0);
  if (searchedNoRef.length >= 2) out.push({ candidate: "inline-ref-marker", evidence: searchedNoRef.map((e) => `${e.manifest.caseId}/${e.manifest.arm}/r${e.manifest.rep}`) });
  const stubIgnored = hEps.filter((e) => e.manifest.arm === "balanced" && (e.mechanism?.folds ?? 0) >= 1 && (e.mechanism?.historyReads ?? 0) === 0 && (e.mechanism?.historySearches ?? 0) === 0 && e.oracle?.passed === false);
  if (stubIgnored.length >= 2) out.push({ candidate: "fold-time-model-hint", evidence: stubIgnored.map((e) => `${e.manifest.caseId}/r${e.manifest.rep}`) });
  return out;
}

export function decide(summary, scenarios, episodes = []) {
  return { ...decideGates(summary, scenarios, episodes), candidates: candidates(summary, episodes) };
}

function decideGates(summary, scenarios, episodes = []) {
  const reasons = [];
  const q = scenarios.qualityIds, cap = scenarios.capabilityIds;
  if (episodes.some((e) => /engine identity|engine-changed|n_ctx/.test(String(e.error ?? "")))) {
    return { decision: "inconclusive", reasons: ["engine-changed"] };
  }
  if (summary.total > 0 && summary.blockedCount / summary.total > 0.2) return { decision: "inconclusive", reasons: [`blocked ${summary.blockedCount}/${summary.total} > 20%`] };
  for (const id of q) {
    const n = summary.byCaseArm[id]?.native, b = summary.byCaseArm[id]?.balanced;
    if (!n || !b) { reasons.push(`${id}: missing arm`); continue; }
    if (b.passed <= n.passed - 2) reasons.push(`${id}: balanced ${b.passed}/${b.episodes} vs native ${n.passed}/${n.episodes}`);
    if (b.wrongActions > n.wrongActions) reasons.push(`${id}: balanced wrong-actions ${b.wrongActions} > native ${n.wrongActions}`);
  }
  if (reasons.length) return { decision: "observe-only", gate: "quality", reasons };

  const hEps = episodes.filter((e) => ["H01", "H02"].includes(e.manifest?.caseId) && e.manifest?.arm === "balanced" && e.status !== "blocked");
  const foldEpisodes = hEps.filter((e) => (e.mechanism?.folds ?? 0) >= 1).length;
  const totalH = hEps.length;
  if (totalH === 0 || foldEpisodes < Math.ceil(totalH * 0.75)) reasons.push(`folds observed in ${foldEpisodes}/${totalH} balanced H episodes (< 75%)`);
  const h01 = hEps.filter((e) => e.manifest.caseId === "H01");
  if (h01.some((e) => e.mechanism?.nonceVerifiedReads == null || e.mechanism?.nonceFolded == null)) {
    reasons.push("H01 nonce recovery evidence unknown");
  } else {
    const h01ok = h01.filter((e) => e.oracle?.passed === true && (e.mechanism?.nonceVerifiedReads ?? 0) >= 1 && e.mechanism?.nonceFolded === true);
    if (h01ok.length < 1) {
      const folded = h01.some((e) => e.mechanism?.nonceFolded === true);
      reasons.push(folded
        ? "H01 balanced never recovered the nonce through a verified read"
        : "H01 balanced never recovered the nonce through a verified read (nonce toolResult was not folded)");
    }
  }
  const h02 = hEps.filter((e) => e.manifest.caseId === "H02");
  if (h02.some((e) => e.mechanism?.foldedErrorResults == null)) {
    reasons.push("H02 foldedErrorResults unknown");
  } else if (h02.some((e) => (e.mechanism?.foldedErrorResults ?? 0) > 0)) {
    reasons.push("H02 balanced folded an isError tool result");
  }
  if (reasons.length) return { decision: "observe-only", gate: "mechanism", reasons };

  if (!(summary.cacheReadChannelAvailable ?? cacheChannelAvailable(episodes))) {
    reasons.push("cacheRead channel unavailable (all observed values 0 or missing)");
  }
  for (const id of cap) {
    const bEps = episodes.filter((e) => e.manifest?.caseId === id && e.manifest?.arm === "balanced" && e.status !== "blocked" && (e.mechanism?.folds ?? 0) > 0);
    const n = summary.byCaseArm[id]?.native, b = summary.byCaseArm[id]?.balanced;
    for (const e of bEps) {
      for (const c of cacheAfterFold(e)) {
        if (c.unknown) reasons.push(`${id}: cacheRead unknown after fold`);
        else if (c.recovered < 2) reasons.push(`${id}: cacheRead did not recover (>=0.5) within 2 requests after fold`);
      }
    }
    if (b && (b.engine.unknown > 0 || b.engine.prefixHitRatio == null)) {
      reasons.push(`${id}: engine metrics unknown`);
    }
    if (n && (n.engine.unknown > 0 || n.engine.prefixHitRatio == null)) {
      reasons.push(`${id}: native engine metrics unknown`);
    }
    if (n && b?.engine.prefixHitRatio != null && n.engine.prefill > 0 && b.engine.prefill > n.engine.prefill * 1.5) {
      reasons.push(`${id}: balanced prefill ${b.engine.prefill} > 1.5× native ${n.engine.prefill}`);
    }
  }
  const h03 = episodes.filter((e) => e.manifest?.caseId === "H03" && e.manifest?.arm === "balanced" && e.status !== "blocked");
  for (const e of h03) {
    if ((e.mechanism?.folds ?? 0) >= 1 && (e.mechanism?.nativeCompactions ?? 0) > 0) {
      reasons.push("H03: native compaction occurred on a folded episode");
    }
  }
  if (reasons.length) return { decision: "observe-only", gate: "cost", reasons };
  return { decision: "limited-balanced-trial", gate: null, reasons: ["quality, mechanism and cost gates passed on this environment; default profile stays observe"] };
}

export function renderMarkdown(summary, decision, manifest) {
  const L = [];
  const metrics = manifest.metricsAvailable === false || manifest.baseUrl
    ? ` · baseUrl ${manifest.baseUrl ?? "n/a"} · /metrics ${manifest.metricsAvailable === false ? "unavailable" : (manifest.metricsAvailable ? "available" : "unspecified")}`
    : "";
  L.push(`# local-eval ${manifest.runId}`, "", `HEAD ${manifest.git?.head} (dirty=${manifest.git?.dirty}) · pi ${manifest.hostVersion} · plugin ${manifest.pluginSha256?.slice(0, 12) ?? "none"} · model ${manifest.model} · thinking ${manifest.thinking}${metrics}`, "");
  L.push(`## decision: ${decision.decision}${decision.gate ? ` (failed gate: ${decision.gate})` : ""}`, "", ...decision.reasons.map((r) => `- ${r}`), "", `candidates: ${decision.candidates?.length ? decision.candidates.map((c) => `${c.candidate} [${c.evidence.join(", ")}]`).join("; ") : "none"}`, "");
  if (summary.blocked.length) { L.push("## blocked episodes", "", ...summary.blocked.map((b) => `- ${b.caseId}/${b.arm}/r${b.rep}: ${b.reason}`), ""); }
  if (summary.priorAttempts?.length) {
    L.push("## prior blocked/error attempts (later overwritten by resume)", "", ...summary.priorAttempts.map((b) => `- ${b.caseId}/${b.arm}/r${b.rep}: ${b.status} ${b.reason ?? ""}`), "");
  }
  if (summary.flags?.length) { L.push("## flags", "", ...summary.flags.map((f) => `- ${f.flag}${f.caseId ? ` ${f.caseId}/${f.arm ?? ""}` : ""}`), ""); }
  const cacheOk = summary.cacheReadChannelAvailable !== false;
  L.push("## oracle & usage (paired)", "", "| case | arm | pass/total | wrong-action | timeout | Σinput | ΣcacheRead | Σuncached | cacheRead/input | unknown usage | TTFT p50 ms | wall p50 s |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) for (const [arm, c] of Object.entries(arms)) L.push(`| ${caseId} | ${arm} | ${c.passed}/${c.episodes} | ${c.wrongActions} | ${c.timeout} | ${c.inputSum} | ${!cacheOk || c.unknownUsage ? "n/a" : c.cacheReadSum} | ${!cacheOk || c.uncachedInputSum == null ? "n/a" : c.uncachedInputSum} | ${!cacheOk ? "n/a" : fmt(c.cacheReadRatio)} | ${c.unknownUsage} | ${c.ttftP50 == null ? "n/a" : Math.round(c.ttftP50)} | ${c.wallP50 == null ? "n/a" : Math.round(c.wallP50 / 1000)} |`);
  L.push("", "## mechanism & evidence", "", "| case | arm | folds | replacements | native compactions | history reads | verified reads | nonce correct | honest | lost evidence / known | removed/invalidated |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) {
    for (const [arm, c] of Object.entries(arms)) {
      const lost = c.quotedVerbatimKnown === 0 ? "n/a" : `${c.lostEvidence}/${c.quotedVerbatimKnown}`;
      const econ = `${c.mech.savedTokensEstimate}/${c.mech.invalidatedTokensEstimate}`;
      L.push(`| ${caseId} | ${arm} | ${c.mech.folds} | ${c.mech.replacements} | ${c.mech.nativeCompactions} | ${c.mech.historyReads} | ${c.mech.verifiedReads} | ${c.nonce.correct} | ${c.nonce.honest} | ${lost} | ${econ} |`);
    }
  }
  L.push("", "## engine (NInfer /metrics deltas)", "", "| case | arm | prefix hit tokens | prefill tokens | hit ratio | unknown |", "|---|---|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) for (const [arm, c] of Object.entries(arms)) L.push(`| ${caseId} | ${arm} | ${c.engine.unknown ? "n/a" : c.engine.prefixHit} | ${c.engine.unknown ? "n/a" : c.engine.prefill} | ${fmt(c.engine.prefixHitRatio)} | ${c.engine.unknown} |`);
  L.push("", "Small samples (2 reps per cell). Counts only; no percentages extrapolated. Quality cases at w262k do not trigger folds by design.", "");
  return L.join("\n");
}

function episodeKey(e) {
  return `${e.manifest?.caseId}/${e.manifest?.arm}/r${e.manifest?.rep}`;
}

export function loadEpisodes(runDir) {
  const jsonl = [];
  const jsonlPath = join(runDir, "episodes.jsonl");
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
      try { jsonl.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  const latest = new Map();
  for (const e of jsonl) latest.set(episodeKey(e), e);
  const dir = join(runDir, "episodes");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name, "result.json");
      if (!existsSync(p)) continue;
      const row = JSON.parse(readFileSync(p, "utf8"));
      latest.set(episodeKey(row), row);
    }
  }
  const episodes = [...latest.values()];
  const priorAttempts = [];
  for (const e of jsonl) {
    const cur = latest.get(episodeKey(e));
    if (!cur || cur.status === e.status) continue;
    if (e.status === "blocked" || e.status === "error") {
      priorAttempts.push({ caseId: e.manifest?.caseId, arm: e.manifest?.arm, rep: e.manifest?.rep, status: e.status, reason: e.error });
    }
  }
  return { episodes, priorAttempts };
}

function fmt(x) { return x == null ? "n/a" : x.toFixed(3); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const runDir = process.argv[2]; if (!runDir) { console.error("runDir required"); process.exit(2); }
  const { episodes, priorAttempts } = loadEpisodes(runDir);
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  if (!manifest.plan) { console.error("frozen plan missing from run manifest"); process.exit(2); }
  const itt = materializeItt(manifest.plan, episodes);
  const summary = summarize(itt, priorAttempts);
  const decision = evaluateTrial({
    pairs: pairsFromItt(manifest.plan, itt),
    capabilities: capabilitiesFromItt(manifest.plan, itt),
    objective: manifest.plan.objective,
    expectedPairs: manifest.plan.expectedPairs,
    expectedCapabilities: manifest.plan.expectedCapabilities,
  });
  writeFileSync(join(runDir, "report.json"), JSON.stringify({
    manifest: { runId: manifest.runId, git: manifest.git, hostVersion: manifest.hostVersion, pluginSha256: manifest.pluginSha256, configHash: manifest.configHash, scenarioHash: manifest.plan.scenarioHash },
    summary,
    decision,
  }, null, 2));
  writeFileSync(join(runDir, "report.md"), renderMarkdown(summary, { ...decision, reasons: [decision.reason], candidates: [] }, manifest));
  console.log(readFileSync(join(runDir, "report.md"), "utf8"));
}
