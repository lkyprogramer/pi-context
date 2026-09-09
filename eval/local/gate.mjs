/**
 * Frozen-trial machine decision. Report prose cannot override this object.
 */
import { evaluateTrial as evaluateTrialArgs, pairedSuccessDelta } from "./accounting.mjs";

export { median, pairedSuccessDelta } from "./accounting.mjs";

export function evaluateTrial(input) {
  const pairs = input?.pairs ?? [];
  const capabilities = input?.capabilities ?? [];
  const objective = input?.objective ?? {};
  if (pairs.some((p) => p.criticalViolation === true)) {
    return { decision: "blocked", reason: "critical violation" };
  }
  const decision = evaluateTrialArgs(
    pairs,
    capabilities,
    objective,
    input?.expectedPairs ?? null,
    input?.expectedCapabilities ?? null,
  );
  const rates = attemptRates(input?.attempts ?? []);
  return { ...decision, ...rates, pairedSuccessDelta: pairedSuccessDelta(pairs) };
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
  return e.episodeId ?? `${e.manifest?.caseId}/${e.manifest?.arm}/r${e.manifest?.rep}`;
}

export function materializeItt(plan, episodes) {
  const byKey = new Map((episodes ?? []).map((e) => [episodeKey(e), e]));
  return (plan?.order ?? []).map((slot) => {
    const key = slot.episodeId ?? `${slot.caseId}/${slot.arm}/r${slot.rep}`;
    return byKey.get(key) ?? {
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
  const byCaseRep = new Map();
  for (const e of episodes ?? []) {
    const caseId = e.manifest?.caseId;
    const rep = e.manifest?.rep;
    if (!quality.has(caseId)) continue;
    const key = `${caseId}:${rep}`;
    const row = byCaseRep.get(key) ?? { caseId, rep };
    const arm = e.manifest?.arm;
    const passed = e.status === "NOT_RUN" ? null : e.oracle?.passed ?? null;
    if (arm === "native") row.native = e;
    if (arm === "balanced") row.candidate = e;
    if (arm === "native") row.nativePassed = passed;
    if (arm === "balanced") row.candidatePassed = passed;
    byCaseRep.set(key, row);
  }
  return [...byCaseRep.values()].map((row) => {
    const cand = row.candidate;
    const foldRequired = plan?.requiresFold?.[row.caseId] ?? false;
    const foldApplied = (cand?.mechanism?.folds ?? 0) >= 1;
    return {
      caseId: row.caseId,
      rep: row.rep,
      nativePassed: row.nativePassed ?? null,
      candidatePassed: row.candidatePassed ?? null,
      foldRequired,
      foldApplied,
      criticalViolation: cand?.oracle?.protectedIntact === false
        || (cand?.mechanism?.foldedErrorResults ?? 0) > 0
        || cand?.status === "blocked" && /critical/i.test(String(cand.error ?? "")),
      evidencePassed: cand?.oracle?.quotedVerbatim !== false
        && (row.caseId !== "H02" || cand?.oracle?.quotedVerbatim === true)
        && cand?.oracle?.passed !== false,
      status: !row.native || !row.candidate || row.native.status === "NOT_RUN" || row.candidate?.status === "NOT_RUN"
        ? "NOT_RUN"
        : cand?.status,
    };
  });
}

export function capabilitiesFromItt(plan, episodes) {
  const ids = new Set(plan?.capabilityIds ?? []);
  return (episodes ?? [])
    .filter((e) => ids.has(e.manifest?.caseId) && e.manifest?.arm === "balanced")
    .map((e) => {
      const foldRequired = plan?.requiresFold?.[e.manifest.caseId] ?? true;
      const foldApplied = (e.mechanism?.folds ?? 0) >= 1;
      const eligible = e.status !== "NOT_RUN" && e.status !== "blocked" && (!foldRequired || foldApplied);
      const quoteOk = e.manifest.caseId !== "H02" || e.oracle?.quotedVerbatim === true;
      return {
        caseId: e.manifest.caseId,
        rep: e.manifest.rep,
        eligible,
        passed: eligible && e.oracle?.passed === true && quoteOk,
      };
    });
}
