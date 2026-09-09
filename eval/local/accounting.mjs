/**
 * Eval token accounting. Pi 0.85.1 OpenAI-completions adapter already subtracts
 * cache from `input` (pi-disjoint). Raw OpenAI prompt_tokens stay inclusive.
 * Missing buckets stay null; they are never clamped to a valid zero.
 */
export const PI_USAGE_MAPPING = "pi-openai-completions-0.85.1-disjoint";

export function count(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function plannedEpisodeId(runId, caseId, arm, rep) {
  return `${runId ?? "local"}:${caseId}:${arm}:r${rep}`;
}

export function normalizeUsage(raw, source) {
  const result = {
    logicalInput: null,
    freshInput: null,
    cachedRead: null,
    cachedWrite: null,
    output: null,
    cacheRatio: null,
    complete: false,
    source,
    error: null,
  };
  if (!raw || typeof raw !== "object") {
    result.error = "usage-unavailable";
    return result;
  }
  let logical;
  let fresh;
  let read;
  let write;
  let out;
  if (source === "pi-disjoint") {
    fresh = count(raw.input);
    read = count(raw.cacheRead);
    write = count(raw.cacheWrite);
    out = count(raw.output);
    logical = fresh != null && read != null && write != null ? fresh + read + write : null;
  } else if (source === "raw-openai-inclusive") {
    logical = count(raw.prompt_tokens);
    const details = raw.prompt_tokens_details && typeof raw.prompt_tokens_details === "object"
      ? raw.prompt_tokens_details
      : {};
    read = count(details.cached_tokens);
    write = count(details.cache_write_tokens);
    out = count(raw.completion_tokens);
    if (logical != null && read != null && write != null && read + write > logical) {
      result.error = "invalid-inclusive-buckets";
      return result;
    }
    fresh = logical != null && read != null && write != null ? logical - read - write : null;
  } else {
    result.error = "unknown-usage-contract";
    return result;
  }
  result.logicalInput = logical;
  result.freshInput = fresh;
  result.cachedRead = read;
  result.cachedWrite = write;
  result.output = out;
  result.cacheRatio = logical != null && logical > 0 && read != null ? read / logical : null;
  result.complete = logical != null && fresh != null && read != null && write != null && out != null;
  if (!result.complete) result.error = "partial-usage";
  return result;
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stable(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const next = {};
    for (const key of Object.keys(value).sort()) next[key] = sortKeys(value[key]);
    return next;
  }
  return value;
}

export function aggregateAttempts(attempts) {
  const episodes = {};
  const attemptSeen = new Map();
  const requestSeen = new Map();
  for (const attempt of attempts) {
    const eid = attempt.episodeId;
    const aid = attempt.attemptId;
    const signature = stable(attempt);
    const key = `${eid}\0${aid}`;
    if (attemptSeen.has(key)) {
      if (attemptSeen.get(key) !== signature) throw new Error("conflicting-attempt-id");
      continue;
    }
    attemptSeen.set(key, signature);
    const ep = episodes[eid] ??= {
      attemptCount: 0,
      firstStatus: attempt.status,
      finalStatus: attempt.status,
      logicalInput: 0,
      knownLogicalSubtotal: 0,
      outputTokens: 0,
      knownOutputSubtotal: 0,
      unknownLogicalRequests: 0,
      unknownOutputRequests: 0,
      requestCount: 0,
    };
    ep.attemptCount += 1;
    ep.finalStatus = attempt.status;
    for (const req of attempt.requests ?? []) {
      const rid = req.requestId;
      const normalized = normalizeUsage(req.usage, req.source ?? "unknown");
      const identity = `${eid}\0${aid}\0${stable(normalized)}`;
      if (requestSeen.has(rid)) {
        if (requestSeen.get(rid) !== identity) throw new Error("conflicting-request-id");
        continue;
      }
      requestSeen.set(rid, identity);
      ep.requestCount += 1;
      if (normalized.logicalInput == null) ep.unknownLogicalRequests += 1;
      else ep.knownLogicalSubtotal += normalized.logicalInput;
      if (normalized.output == null) ep.unknownOutputRequests += 1;
      else ep.knownOutputSubtotal += normalized.output;
    }
    ep.logicalInput = ep.unknownLogicalRequests ? null : ep.knownLogicalSubtotal;
    ep.outputTokens = ep.unknownOutputRequests ? null : ep.knownOutputSubtotal;
  }
  return { episodes, attempts: attemptSeen.size, requests: requestSeen.size };
}

export function pairedSuccessDelta(pairs) {
  if (!pairs.length) return null;
  if (pairs.some((p) => typeof p.nativePassed !== "boolean" || typeof p.candidatePassed !== "boolean")) return null;
  return pairs.reduce((s, p) => s + (Number(p.candidatePassed) - Number(p.nativePassed)), 0) / pairs.length;
}

export function evaluateTrial(pairs, capabilities, objective, expectedPairs = null, expectedCapabilities = null) {
  const answer = (decision, reason) => ({ decision, reason });
  if (!pairs.length || (expectedPairs != null && pairs.length !== expectedPairs)) {
    return answer("inconclusive", "planned denominator incomplete");
  }
  if (pairedSuccessDelta(pairs) == null) return answer("inconclusive", "missing quality outcome");
  if (pairs.some((p) => p.criticalViolation === true)) return answer("observe-only", "critical violation");
  if (pairs.some((p) => p.foldRequired === true && p.foldApplied !== true)) {
    return answer("inconclusive", "optimization not exercised");
  }
  if (pairs.some((p) => p.evidencePassed !== true)) {
    return answer("review-needed", "required evidence failed or unmeasured");
  }
  if (pairs.some((p) => p.candidatePassed !== true)) {
    return answer("review-needed", "candidate task failure; retain first-attempt details");
  }
  if (expectedCapabilities != null && capabilities.length !== expectedCapabilities) {
    return answer("inconclusive", "capability denominator incomplete");
  }
  if (!capabilities.length || capabilities.some((c) => c.eligible !== true || c.passed !== true)) {
    return answer("inconclusive", "capability unproven");
  }
  if (objective.known !== true) return answer("quality-qualified-cost-unknown", "quality is not cost proof");
  const change = objective.relativeChange;
  const minimum = objective.minImprovement;
  if (typeof change !== "number" || typeof minimum !== "number") {
    return answer("inconclusive", "missing preregistered objective");
  }
  if (!["logical-input", "wall-time", "monetary-cost"].includes(objective.metric)) {
    return answer("inconclusive", "use a separate preregistered protocol for a quality-first objective");
  }
  if (change > -minimum) return answer("history-only", "no demonstrated objective improvement");
  return answer("limited-balanced-trial", "small canary only; no default change and no noninferiority claim");
}

export function nextAttemptId(episodeId, priorCount) {
  return `${episodeId}:a${priorCount + 1}`;
}
