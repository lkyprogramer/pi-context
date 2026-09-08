#!/usr/bin/env node
/**
 * Paired report + mechanical decision for a local-eval run.
 *   node report.mjs <runDir>            → writes <runDir>/report.md and report.json
 * Pure functions `summarize` and `decide` are exported for tests. Unknown usage is counted, never zeroed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function summarize(episodes) {
  const byCaseArm = {};
  const blocked = [];
  for (const e of episodes) {
    const { caseId, arm, rep } = e.manifest;
    if (e.status === "blocked") { blocked.push({ caseId, arm, rep, reason: e.error }); continue; }
    const cell = ((byCaseArm[caseId] ??= {})[arm] ??= { episodes: 0, passed: 0, failed: 0, timeout: 0, inputSum: 0, cacheReadSum: 0, outputSum: 0, unknownUsage: 0, requests: 0, walls: [], mech: { folds: 0, replacements: 0, nativeCompactions: 0, historyReads: 0, historySearches: 0, verifiedReads: 0 }, engine: { prefixHit: 0, prefill: 0, unknown: 0, prefixHitRatio: null }, cacheAfterFold: [], nonce: { correct: 0, honest: 0 }, ttfts: [], wrongActions: 0, lostEvidence: 0, quotedVerbatimKnown: 0 });
    cell.episodes++;
    if (e.status === "timeout") cell.timeout++;
    if (e.oracle?.passed === true) cell.passed++; else if (e.oracle?.passed === false) cell.failed++;
    if (e.oracle?.nonceCorrect) cell.nonce.correct++; if (e.oracle?.honest) cell.nonce.honest++;
    // wrong-action: any protected-path change or edit outside the editable set (grade.sh reports both).
    if (e.oracle?.protectedIntact === false || (e.oracle?.outsideEditable ?? 0) > 0) cell.wrongActions++;
    // lost-critical-evidence (H02): the model was asked to quote an early failing assertion verbatim; false = evidence lost in that arm.
    if (typeof e.oracle?.quotedVerbatim === "boolean") { cell.quotedVerbatimKnown++; if (e.oracle.quotedVerbatim === false) cell.lostEvidence++; }
    cell.walls.push(e.wallMs ?? 0);
    for (const r of e.requests ?? []) {
      cell.requests++;
      if (typeof r.ttftMs === "number") cell.ttfts.push(r.ttftMs);
      const u = r.usage ?? r;
      if (u.input == null) { cell.unknownUsage++; continue; }
      cell.inputSum += u.input; cell.cacheReadSum += u.cacheRead ?? 0; cell.outputSum += u.output ?? 0;
    }
    for (const k of Object.keys(cell.mech)) cell.mech[k] += e.mechanism?.[k] ?? 0;
    if (e.engine?.prefixHitTokensDelta == null || e.engine?.prefillTokensDelta == null) cell.engine.unknown++;
    else { cell.engine.prefixHit += e.engine.prefixHitTokensDelta; cell.engine.prefill += e.engine.prefillTokensDelta; }
    // cacheRead right after a fold: first request with planId change (telemetry) or, without telemetry, min cacheRead/input after folds>0
    if ((e.mechanism?.folds ?? 0) > 0) {
      const seq = (e.requests ?? []).map((r) => r.usage ?? r).filter((u) => u.input);
      const ratios = seq.map((u) => (u.cacheRead ?? 0) / u.input);
      const dip = ratios.indexOf(Math.min(...ratios));
      cell.cacheAfterFold.push({ dipRatio: ratios[dip] ?? null, recovered: ratios.slice(dip + 1, dip + 3).filter((x) => x >= 0.5).length });
    }
  }
  for (const c of Object.values(byCaseArm)) for (const cell of Object.values(c)) {
    const denom = cell.engine.prefixHit + cell.engine.prefill;
    cell.engine.prefixHitRatio = cell.engine.unknown === 0 && denom > 0 ? cell.engine.prefixHit / denom : null;
    cell.wallP50 = median(cell.walls);
    cell.ttftP50 = cell.ttfts.length ? median(cell.ttfts) : null;
    cell.cacheReadRatio = cell.inputSum > 0 ? cell.cacheReadSum / cell.inputSum : null;
    // uncached input is the part the engine actually had to prefill (per Pi usage; cross-check with engine.prefill).
    cell.uncachedInputSum = cell.inputSum - cell.cacheReadSum;
  }
  return { byCaseArm, blocked, blockedCount: blocked.length, total: episodes.length };
}

// 6.2 signals, independent of the gates (design/00-target §6.2, protocol rule 6). Episode-level, never from cell sums.
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
  return { ...decideGates(summary, scenarios), candidates: candidates(summary, episodes) };
}

function decideGates(summary, scenarios) {
  const reasons = [];
  const q = scenarios.qualityIds, cap = scenarios.capabilityIds;
  if (summary.total > 0 && summary.blockedCount / summary.total > 0.2) return { decision: "inconclusive", reasons: [`blocked ${summary.blockedCount}/${summary.total} > 20%`] };
  // 1. quality gate
  for (const id of q) {
    const n = summary.byCaseArm[id]?.native, b = summary.byCaseArm[id]?.balanced;
    if (!n || !b) { reasons.push(`${id}: missing arm`); continue; }
    if (b.passed <= n.passed - 2) reasons.push(`${id}: balanced ${b.passed}/${b.episodes} vs native ${n.passed}/${n.episodes}`);
    if (b.wrongActions > n.wrongActions) reasons.push(`${id}: balanced wrong-actions ${b.wrongActions} > native ${n.wrongActions}`);
  }
  if (reasons.length) return { decision: "observe-only", gate: "quality", reasons };
  // 2. mechanism gate (H01/H02 balanced)
  const h = cap.filter((id) => id !== "H03").map((id) => summary.byCaseArm[id]?.balanced).filter(Boolean);
  const foldEpisodes = h.reduce((s, c) => s + Math.min(c.episodes, c.mech.folds > 0 ? c.episodes : 0), 0);
  const totalH = h.reduce((s, c) => s + c.episodes, 0);
  if (totalH === 0 || foldEpisodes < Math.ceil(totalH * 0.75)) reasons.push(`folds observed in ${foldEpisodes}/${totalH} balanced H episodes (< 75%)`);
  const h01 = summary.byCaseArm.H01?.balanced;
  if (!h01 || h01.nonce.correct < 1 || h01.mech.verifiedReads < 1) reasons.push("H01 balanced never recovered the nonce through a verified read");
  if (reasons.length) return { decision: "observe-only", gate: "mechanism", reasons };
  // 3. cost gate
  for (const id of cap) {
    const b = summary.byCaseArm[id]?.balanced, n = summary.byCaseArm[id]?.native;
    if (!b) continue;
    for (const c of b.cacheAfterFold) if (c.recovered < 1) reasons.push(`${id}: cacheRead did not recover (>=0.5) within 2 requests after fold`);
    if (n && b.engine.prefixHitRatio != null && n.engine.prefill > 0 && b.engine.prefill > n.engine.prefill * 1.5) reasons.push(`${id}: balanced prefill ${b.engine.prefill} > 1.5× native ${n.engine.prefill}`);
  }
  if (reasons.length) return { decision: "observe-only", gate: "cost", reasons };
  return { decision: "limited-balanced-trial", gate: null, reasons: ["quality, mechanism and cost gates passed on this environment; default profile stays observe"] };
}

export function renderMarkdown(summary, decision, manifest) {
  const L = [];
  L.push(`# local-eval ${manifest.runId}`, "", `HEAD ${manifest.git?.head} (dirty=${manifest.git?.dirty}) · pi ${manifest.hostVersion} · plugin ${manifest.pluginSha256?.slice(0, 12) ?? "none"} · model ${manifest.model} · thinking ${manifest.thinking}`, "");
  L.push(`## decision: ${decision.decision}${decision.gate ? ` (failed gate: ${decision.gate})` : ""}`, "", ...decision.reasons.map((r) => `- ${r}`), "", `candidates: ${decision.candidates?.length ? decision.candidates.map((c) => `${c.candidate} [${c.evidence.join(", ")}]`).join("; ") : "none"}`, "");
  if (summary.blocked.length) { L.push("## blocked episodes", "", ...summary.blocked.map((b) => `- ${b.caseId}/${b.arm}/r${b.rep}: ${b.reason}`), ""); }
  L.push("## oracle & usage (paired)", "", "| case | arm | pass/total | wrong-action | timeout | Σinput | ΣcacheRead | Σuncached | cacheRead/input | unknown usage | TTFT p50 ms | wall p50 s |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) for (const [arm, c] of Object.entries(arms)) L.push(`| ${caseId} | ${arm} | ${c.passed}/${c.episodes} | ${c.wrongActions} | ${c.timeout} | ${c.inputSum} | ${c.cacheReadSum} | ${c.uncachedInputSum} | ${fmt(c.cacheReadRatio)} | ${c.unknownUsage} | ${c.ttftP50 == null ? "n/a" : Math.round(c.ttftP50)} | ${Math.round(c.wallP50 / 1000)} |`);
  L.push("", "## mechanism & evidence", "", "| case | arm | folds | replacements | native compactions | history reads | verified reads | nonce correct | honest | lost evidence / known |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) for (const [arm, c] of Object.entries(arms)) L.push(`| ${caseId} | ${arm} | ${c.mech.folds} | ${c.mech.replacements} | ${c.mech.nativeCompactions} | ${c.mech.historyReads} | ${c.mech.verifiedReads} | ${c.nonce.correct} | ${c.nonce.honest} | ${c.lostEvidence}/${c.quotedVerbatimKnown} |`);
  L.push("", "## engine (NInfer /metrics deltas)", "", "| case | arm | prefix hit tokens | prefill tokens | hit ratio | unknown |", "|---|---|---:|---:|---:|---:|");
  for (const [caseId, arms] of Object.entries(summary.byCaseArm)) for (const [arm, c] of Object.entries(arms)) L.push(`| ${caseId} | ${arm} | ${c.engine.prefixHit} | ${c.engine.prefill} | ${fmt(c.engine.prefixHitRatio)} | ${c.engine.unknown} |`);
  L.push("", "Small samples (2 reps per cell). Counts only; no percentages extrapolated. Quality cases at w262k do not trigger folds by design.", "");
  return L.join("\n");
}

function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function fmt(x) { return x == null ? "n/a" : x.toFixed(3); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const runDir = process.argv[2]; if (!runDir) { console.error("runDir required"); process.exit(2); }
  const episodes = readFileSync(join(runDir, "episodes.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const scenPath = join(runDir, "..", "..", "..", "docs/pi-context-native-first-audit-v6.0.0/testing/scenarios.json");
  const scenarios = JSON.parse(readFileSync(existsSync(scenPath) ? scenPath : new URL("../scenarios.json", import.meta.url), "utf8"));
  const summary = summarize(episodes);
  const decision = decide(summary, scenarios, episodes);
  writeFileSync(join(runDir, "report.json"), JSON.stringify({ manifest: { runId: manifest.runId, git: manifest.git, hostVersion: manifest.hostVersion, pluginSha256: manifest.pluginSha256, configHash: manifest.configHash }, summary, decision }, null, 2));
  writeFileSync(join(runDir, "report.md"), renderMarkdown(summary, decision, manifest));
  console.log(readFileSync(join(runDir, "report.md"), "utf8"));
}
