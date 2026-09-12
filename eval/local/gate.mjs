/**
 * Frozen-trial machine decision. Report prose cannot override this object.
 */
import { pairedSuccessDelta } from "./accounting.mjs";

export { median, pairedSuccessDelta } from "./accounting.mjs";

export const METRICS = [
  "fresh-input",
  "logical-input",
  "wall-time",
  "cacheRead",
  "engine-prefill",
  "native-compactions",
  "requests",
];

const PRIMARY_METRICS = ["fresh-input", "logical-input", "wall-time", "monetary-cost"];

export function metricOf(episode, metric) {
  if (!episode) return null;
  const reqs = Array.isArray(episode.requests) ? episode.requests : [];
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  if (metric === "fresh-input") {
    if (reqs.length === 0) return 0;
    let sum = 0;
    for (const req of reqs) {
      const value = req.normalized?.freshInput;
      if (value == null) return null;
      const n = num(value);
      if (n == null) return null;
      sum += n;
    }
    return sum;
  }
  if (metric === "logical-input") {
    if (reqs.length === 0) return 0;
    let sum = 0;
    for (const req of reqs) {
      const value = req.normalized?.logicalInput;
      if (value == null) return null;
      const n = num(value);
      if (n == null) return null;
      sum += n;
    }
    return sum;
  }
  if (metric === "cacheRead") {
    if (reqs.length === 0) return 0;
    let sum = 0;
    for (const req of reqs) {
      const value = req.normalized?.cachedRead ?? req.normalized?.cacheRead;
      if (value == null) return null;
      const n = num(value);
      if (n == null) return null;
      sum += n;
    }
    return sum;
  }
  if (metric === "wall-time") return num(episode.wallMs);
  if (metric === "engine-prefill") {
    const value = episode.engine?.prefillTokensDelta;
    return value == null ? null : num(value);
  }
  if (metric === "native-compactions") {
    const value = episode.mechanism?.nativeCompactions;
    return value == null ? 0 : num(value);
  }
  if (metric === "requests") return reqs.length;
  if (metric === "monetary-cost") {
    if (!episode.pricingIdentity) return null;
    return num(episode.monetaryCost);
  }
  return null;
}

export function metricsOf(episode) {
  const out = {};
  for (const metric of METRICS) out[metric] = metricOf(episode, metric);
  return out;
}

export function objectiveFromPairs(pairs, planObjective = {}) {
  const primaryMetric = planObjective.primary?.metric ?? planObjective.metric ?? "fresh-input";
  const minImprovement = planObjective.primary?.minImprovement ?? planObjective.minImprovement ?? 0.1;
  const secondaryList = planObjective.secondary ?? [];

  const summarize = (metric) => {
    let nativeSum = 0;
    let candidateSum = 0;
    let used = 0;
    for (const pair of pairs ?? []) {
      const native = pair.nativeMetric?.[metric];
      const candidate = pair.candidateMetric?.[metric];
      if (native == null || candidate == null) {
        return { known: false, relativeChange: null, nativeSum: null, candidateSum: null, pairsUsed: 0 };
      }
      nativeSum += native;
      candidateSum += candidate;
      used += 1;
    }
    if (used === 0 || nativeSum === 0) {
      return {
        known: false,
        relativeChange: null,
        nativeSum: used === 0 ? null : nativeSum,
        candidateSum: used === 0 ? null : candidateSum,
        pairsUsed: used,
      };
    }
    return {
      known: true,
      relativeChange: candidateSum / nativeSum - 1,
      nativeSum,
      candidateSum,
      pairsUsed: used,
    };
  };

  const primaryStats = summarize(primaryMetric);
  const secondary = {};
  for (const metric of secondaryList) {
    const stats = summarize(metric);
    secondary[metric] = {
      known: stats.known,
      relativeChange: stats.relativeChange,
      nativeSum: stats.nativeSum,
      candidateSum: stats.candidateSum,
    };
  }
  return {
    primary: {
      metric: primaryMetric,
      minImprovement,
      known: primaryStats.known,
      relativeChange: primaryStats.relativeChange,
      nativeSum: primaryStats.nativeSum,
      candidateSum: primaryStats.candidateSum,
      pairsUsed: primaryStats.pairsUsed,
    },
    secondary,
  };
}

export function discordance(pairs, exactQuoteIds = []) {
  const quoteSet = new Set(exactQuoteIds ?? []);
  const discordant = [];
  const bByCase = {};
  let b = 0;
  let c = 0;
  let shared = 0;
  for (const pair of pairs ?? []) {
    if (pair.status === "NOT_RUN") continue;
    const quoteRequired = quoteSet.has(pair.caseId);
    const quoteFail = quoteRequired && pair.candidateQuote === false && pair.nativeQuote === true;
    if (quoteFail) {
      discordant.push({ caseId: pair.caseId, rep: pair.rep, kind: "quote-discordant" });
      b += 1;
      bByCase[pair.caseId] = (bByCase[pair.caseId] ?? 0) + 1;
      continue;
    }
    if (pair.candidatePassed === false && pair.nativePassed === true) {
      discordant.push({ caseId: pair.caseId, rep: pair.rep, kind: "candidate-fail-native-pass" });
      b += 1;
      bByCase[pair.caseId] = (bByCase[pair.caseId] ?? 0) + 1;
      continue;
    }
    if (pair.candidatePassed === true && pair.nativePassed === false) {
      discordant.push({ caseId: pair.caseId, rep: pair.rep, kind: "candidate-pass-native-fail" });
      c += 1;
      continue;
    }
    if (pair.candidatePassed === false && pair.nativePassed === false) {
      discordant.push({ caseId: pair.caseId, rep: pair.rep, kind: "shared-failure" });
      shared += 1;
    }
  }
  return { b, c, shared, bByCase, discordant };
}

function primaryOf(objective) {
  if (!objective || typeof objective !== "object") return {};
  if (objective.primary && typeof objective.primary === "object") return objective.primary;
  return objective;
}

function clipReason(reason, extraCount) {
  if (reason.length <= 2000) return reason;
  return `${reason.slice(0, 1960)} +${extraCount} more`;
}

function emptyObjective() {
  return {
    primary: {
      metric: "fresh-input",
      minImprovement: 0.1,
      known: false,
      relativeChange: null,
      nativeSum: null,
      candidateSum: null,
      pairsUsed: 0,
    },
    secondary: {},
  };
}

function identityOf(episode) {
  return {
    caseId: episode?.caseId ?? episode?.manifest?.caseId,
    arm: episode?.arm ?? episode?.manifest?.arm,
    rep: episode?.rep ?? episode?.manifest?.rep,
  };
}

export function regimePairsFromItt(plan, episodes, lane) {
  const ids = new Set(plan?.regimeLanes?.[lane]?.ids ?? []);
  const byCaseRep = new Map();
  for (const episode of episodes ?? []) {
    const { caseId, arm, rep } = identityOf(episode);
    if (!ids.has(caseId)) continue;
    const key = `${caseId}:${rep}`;
    const row = byCaseRep.get(key) ?? { caseId, rep, lane: lane === "warm" ? "W" : "X" };
    const passed = episode.status === "NOT_RUN" ? null : episode.oracle?.passed ?? null;
    if (arm === "native") {
      row.native = episode;
      row.nativePassed = passed;
    }
    if (arm === "balanced") {
      row.candidate = episode;
      row.candidatePassed = passed;
    }
    byCaseRep.set(key, row);
  }
  const exact = new Set(plan?.exactQuoteIds ?? []);
  return [...byCaseRep.values()].map((row) => finishPair(plan, row, exact, lane === "warm" ? "W" : "X"));
}

export function regimeSummary(pairs, planObjective) {
  const counts = discordance(pairs, []);
  let nativeCompactions = 0;
  let candidateCompactions = 0;
  let nativeQuoteFail = 0;
  let candidateQuoteFail = 0;
  for (const pair of pairs ?? []) {
    nativeCompactions += pair.nativeMetric?.["native-compactions"] ?? 0;
    candidateCompactions += pair.candidateMetric?.["native-compactions"] ?? 0;
    if (pair.nativeQuote === false) nativeQuoteFail += 1;
    if (pair.candidateQuote === false) candidateQuoteFail += 1;
  }
  return {
    pairs: (pairs ?? []).length,
    b: counts.b,
    c: counts.c,
    shared: counts.shared,
    objective: objectiveFromPairs(pairs, planObjective),
    nativeCompactions: { native: nativeCompactions, candidate: candidateCompactions },
    quoteFailures: { native: nativeQuoteFail, candidate: candidateQuoteFail },
  };
}

function finishPair(plan, row, exact, lane) {
  const cand = row.candidate;
  const native = row.native;
  const foldRequired = plan?.requiresFold?.[row.caseId] ?? false;
  const foldApplied = (cand?.mechanism?.folds ?? 0) >= 1;
  const nativeCompactions = native?.mechanism?.nativeCompactions ?? 0;
  let status = !native || !cand || native.status === "NOT_RUN" || cand?.status === "NOT_RUN"
    ? "NOT_RUN"
    : cand?.status;
  if (lane === "X" && native && (nativeCompactions ?? 0) < 1) status = status === "NOT_RUN" ? status : "unexercised";
  if (lane === "X" && foldRequired && !foldApplied) status = status === "NOT_RUN" ? status : "unexercised";
  return {
    caseId: row.caseId,
    rep: row.rep,
    lane: lane ?? row.lane ?? "Q",
    nativePassed: row.nativePassed ?? null,
    candidatePassed: row.candidatePassed ?? null,
    nativeQuote: exact.has(row.caseId) ? (native?.oracle?.quotedVerbatim ?? null) : null,
    candidateQuote: exact.has(row.caseId) ? (cand?.oracle?.quotedVerbatim ?? null) : null,
    foldRequired,
    foldApplied,
    criticalViolation: cand?.oracle?.protectedIntact === false
      || (cand?.mechanism?.foldedErrorResults ?? 0) > 0
      || (cand?.status === "blocked" && /critical/i.test(String(cand.error ?? ""))),
    nativeMetric: metricsOf(native),
    candidateMetric: metricsOf(cand),
    status,
  };
}

export function evaluateTrial(input) {
  const pairs = input?.pairs ?? [];
  const capabilities = input?.capabilities ?? [];
  const plan = input?.plan ?? {};
  const expectedPairs = input?.expectedPairs ?? plan.expectedPairs ?? null;
  const expectedCapabilities = input?.expectedCapabilities ?? plan.expectedCapabilities ?? null;
  const exactQuoteIds = plan.exactQuoteIds ?? [];
  const objective = input.objective && (input.objective.primary || input.objective.metric)
    ? (input.objective.primary ? input.objective : { primary: primaryOf(input.objective), secondary: input.objective.secondary ?? {} })
    : objectiveFromPairs(pairs, plan.objective);
  const primary = primaryOf(objective);
  const rates = attemptRates(input?.attempts ?? []);
  const flags = [];
  const regimes = input.regimes ?? {};

  const answer = (decision, reason, extra = {}) => {
    const { discordant: extraDisc, ...rest } = extra;
    const disc = extraDisc && typeof extraDisc === "object" && Array.isArray(extraDisc.discordant)
      ? extraDisc
      : discordance(pairs, exactQuoteIds);
    const named = disc.discordant
      .filter((row) => row.kind === "candidate-fail-native-pass" || row.kind === "quote-discordant")
      .map((row) => `${row.caseId}/r${row.rep} ${row.kind}`);
    let nextReason = reason;
    if (decision === "review-needed") {
      nextReason = `candidate new failures: ${named.join("; ")}; b=${disc.b} c=${disc.c} shared=${disc.shared}`;
    }
    nextReason = clipReason(nextReason, disc.discordant.length);
    const sharedCases = [...new Set(disc.discordant.filter((row) => row.kind === "shared-failure").map((row) => row.caseId))];
    if (sharedCases.length) flags.push(...sharedCases.map((id) => `task-noise: ${id}`));
    const result = {
      decision,
      reason: nextReason,
      discordant: disc.discordant,
      counts: { b: disc.b, c: disc.c, shared: disc.shared, bByCase: disc.bByCase },
      attemptRates: rates,
      firstAttemptSuccess: rates.firstAttemptSuccess,
      finalAttemptSuccess: rates.finalAttemptSuccess,
      pairedSuccessDelta: pairedSuccessDelta(pairs),
      objective: objective.primary ? objective : { primary, secondary: {} },
      regimes,
      candidates: input.candidates ?? [],
      diagnosticOnly: Boolean(input.diagnosticOnly),
      flags,
      ...rest,
    };
    if (input.diagnosticOnly) {
      result.decision = "inconclusive";
      result.reason = input.dirtyReason ?? "dirty-tree diagnostic run";
      result.diagnosticOnly = true;
    }
    return result;
  };

  const regimePairs = [
    ...(regimes.warm?.pairsList ?? []),
    ...(regimes.long?.pairsList ?? []),
    ...(Array.isArray(regimes.warm) ? [] : []),
  ];
  const regimeCritical = [
    ...(input.regimePairs ?? []),
    ...regimePairs,
  ];
  if (pairs.some((p) => p.criticalViolation === true) || regimeCritical.some((p) => p.criticalViolation === true)) {
    return answer("blocked", "critical violation");
  }
  if (!pairs.length || (expectedPairs != null && pairs.length !== expectedPairs)) {
    return answer("inconclusive", "planned denominator incomplete");
  }
  if (pairs.some((p) => p.nativePassed == null || p.candidatePassed == null) || pairedSuccessDelta(pairs) == null) {
    return answer("inconclusive", "missing quality outcome");
  }
  if (pairs.some((p) => p.foldRequired === true && p.foldApplied !== true)) {
    return answer("inconclusive", "optimization not exercised");
  }
  if (pairs.some((p) => exactQuoteIds.includes(p.caseId) && p.candidateQuote == null)) {
    return answer("inconclusive", "required evidence unmeasured");
  }
  const disc = discordance(pairs, exactQuoteIds);
  const caseB = Object.values(disc.bByCase).some((n) => n >= 2);
  if (caseB || disc.b - disc.c >= 2) {
    return answer("review-needed", "candidate new failures", { discordant: disc });
  }
  if (expectedCapabilities != null && capabilities.length !== expectedCapabilities) {
    return answer("inconclusive", "capability denominator incomplete", { discordant: disc });
  }
  if (!capabilities.length || capabilities.some((c) => c.eligible !== true || c.passed !== true)) {
    return answer("inconclusive", "capability unproven", { discordant: disc });
  }
  if (primary.known !== true) {
    return answer("quality-qualified-cost-unknown", "quality is not cost proof", { discordant: disc });
  }
  const change = primary.relativeChange;
  const minimum = primary.minImprovement;
  if (typeof change !== "number" || typeof minimum !== "number") {
    return answer("inconclusive", "missing preregistered objective", { discordant: disc });
  }
  if (!PRIMARY_METRICS.includes(primary.metric)) {
    return answer("inconclusive", "use a separate preregistered protocol for a quality-first objective", { discordant: disc });
  }
  if (change > -minimum) return answer("history-only", "no demonstrated objective improvement", { discordant: disc });
  return answer("limited-balanced-trial", "small canary only; no default change and no noninferiority claim", { discordant: disc });
}

export function attemptRates(attempts) {
  const first = [];
  const finals = [];
  const byEpisode = new Map();
  for (const a of attempts) {
    const list = byEpisode.get(a.episodeId) ?? [];
    list.push(a);
    byEpisode.set(a.episodeId, list);
  }
  for (const list of byEpisode.values()) {
    first.push(list[0]?.status === "passed" || list[0]?.status === "complete");
    finals.push(list[list.length - 1]?.status === "passed" || list[list.length - 1]?.status === "complete");
  }
  return {
    firstAttemptSuccess: first.length ? first.filter(Boolean).length / first.length : null,
    finalAttemptSuccess: finals.length ? finals.filter(Boolean).length / finals.length : null,
  };
}

export function episodeKey(e) {
  const { caseId, arm, rep } = identityOf(e);
  return e.episodeId ?? `${caseId}/${arm}/r${rep}`;
}

export function materializeItt(plan, episodes) {
  const byKey = new Map();
  for (const e of episodes ?? []) {
    byKey.set(episodeKey(e), e);
    const { caseId, arm, rep } = identityOf(e);
    const fallback = `${caseId}/${arm}/r${rep}`;
    if (fallback.includes("undefined")) continue;
    if (!byKey.has(fallback)) byKey.set(fallback, e);
  }
  return (plan?.order ?? []).map((slot) => {
    const key = slot.episodeId ?? `${slot.caseId}/${slot.arm}/r${slot.rep}`;
    const fallback = `${slot.caseId}/${slot.arm}/r${slot.rep}`;
    return byKey.get(key) ?? byKey.get(fallback) ?? {
      episodeId: slot.episodeId ?? key,
      manifest: slot,
      status: "NOT_RUN",
      oracle: { passed: null },
      mechanism: {},
    };
  });
}

export function pairsFromItt(plan, episodes) {
  const quality = new Set(plan?.qualityIds ?? []);
  const exact = new Set(plan?.exactQuoteIds ?? []);
  const byCaseRep = new Map();
  for (const e of episodes ?? []) {
    const { caseId, arm, rep } = identityOf(e);
    if (!quality.has(caseId)) continue;
    const key = `${caseId}:${rep}`;
    const row = byCaseRep.get(key) ?? { caseId, rep };
    const passed = e.status === "NOT_RUN" ? null : e.oracle?.passed ?? null;
    if (arm === "native") {
      row.native = e;
      row.nativePassed = passed;
    }
    if (arm === "balanced") {
      row.candidate = e;
      row.candidatePassed = passed;
    }
    byCaseRep.set(key, row);
  }
  return [...byCaseRep.values()].map((row) => finishPair(plan, row, exact, "Q"));
}

export function capabilitiesFromItt(plan, episodes) {
  const ids = new Set(plan?.capabilityIds ?? []);
  const exact = new Set(plan?.exactQuoteIds ?? []);
  return (episodes ?? [])
    .filter((e) => {
      const { caseId, arm } = identityOf(e);
      return ids.has(caseId) && arm === "balanced";
    })
    .map((e) => {
      const { caseId, rep } = identityOf(e);
      const foldRequired = plan?.requiresFold?.[caseId] ?? true;
      const foldApplied = (e.mechanism?.folds ?? 0) >= 1;
      const eligible = e.status !== "NOT_RUN" && e.status !== "blocked" && (!foldRequired || foldApplied);
      const quoteOk = !exact.has(caseId) || e.oracle?.quotedVerbatim === true;
      return {
        caseId,
        rep,
        eligible,
        passed: eligible && e.oracle?.passed === true && quoteOk,
      };
    });
}

export { emptyObjective };
