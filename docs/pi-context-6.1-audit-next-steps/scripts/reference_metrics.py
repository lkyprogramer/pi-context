"""Offline normative examples, not a live-model benchmark or production patch."""
from __future__ import annotations
import json
from statistics import median as _median
from typing import Any


def count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def normalize_usage(raw: dict[str, Any] | None, source: str) -> dict[str, Any]:
    result = dict(logicalInput=None, freshInput=None, cachedRead=None,
                  cachedWrite=None, output=None, cacheRatio=None,
                  complete=False, source=source, error=None)
    if not isinstance(raw, dict):
        result['error'] = 'usage-unavailable'
        return result
    if source == 'pi-disjoint':
        fresh, read, write, out = (count(raw.get(k)) for k in ('input', 'cacheRead', 'cacheWrite', 'output'))
        logical = fresh + read + write if None not in (fresh, read, write) else None
    elif source == 'raw-openai-inclusive':
        logical = count(raw.get('prompt_tokens'))
        details = raw.get('prompt_tokens_details')
        details = details if isinstance(details, dict) else {}
        # Defaults are deliberately NOT invented. Caller must map the actual provider contract.
        read, write, out = count(details.get('cached_tokens')), count(details.get('cache_write_tokens')), count(raw.get('completion_tokens'))
        if None not in (logical, read, write) and read + write > logical:
            result['error'] = 'invalid-inclusive-buckets'
            return result
        fresh = logical - read - write if None not in (logical, read, write) else None
    else:
        result['error'] = 'unknown-usage-contract'
        return result
    result.update(logicalInput=logical, freshInput=fresh, cachedRead=read,
                  cachedWrite=write, output=out,
                  cacheRatio=read/logical if logical is not None and logical > 0 and read is not None else None,
                  complete=None not in (logical, fresh, read, write, out))
    if not result['complete']:
        result['error'] = 'partial-usage'
    return result


def median(values: list[float]) -> float | None:
    return float(_median(values)) if values else None


def aggregate_attempts(attempts: list[dict[str, Any]]) -> dict[str, Any]:
    episodes: dict[str, Any] = {}
    attempt_seen: dict[tuple[str, str], str] = {}
    request_seen: dict[str, tuple[str, str, str]] = {}
    for attempt in attempts:
        eid, aid = attempt['episodeId'], attempt['attemptId']
        signature = json.dumps(attempt, sort_keys=True, ensure_ascii=False)
        key = (eid, aid)
        if key in attempt_seen:
            if attempt_seen[key] != signature:
                raise ValueError('conflicting-attempt-id')
            continue
        attempt_seen[key] = signature
        ep = episodes.setdefault(eid, dict(attemptCount=0, firstStatus=attempt['status'],
            finalStatus=attempt['status'], logicalInput=0, knownLogicalSubtotal=0,
            outputTokens=0, knownOutputSubtotal=0, unknownLogicalRequests=0,
            unknownOutputRequests=0, requestCount=0))
        ep['attemptCount'] += 1
        ep['finalStatus'] = attempt['status']
        for req in attempt.get('requests', []):
            rid = req['requestId']
            normalized = normalize_usage(req.get('usage'), req.get('source', 'unknown'))
            sig = json.dumps(normalized, sort_keys=True)
            identity = (eid, aid, sig)
            if rid in request_seen:
                if request_seen[rid] != identity:
                    raise ValueError('conflicting-request-id')
                continue
            request_seen[rid] = identity
            ep['requestCount'] += 1
            logical, output = normalized['logicalInput'], normalized['output']
            if logical is None:
                ep['unknownLogicalRequests'] += 1
            else:
                ep['knownLogicalSubtotal'] += logical
            if output is None:
                ep['unknownOutputRequests'] += 1
            else:
                ep['knownOutputSubtotal'] += output
        ep['logicalInput'] = None if ep['unknownLogicalRequests'] else ep['knownLogicalSubtotal']
        ep['outputTokens'] = None if ep['unknownOutputRequests'] else ep['knownOutputSubtotal']
    return {'episodes': episodes, 'attempts': len(attempt_seen), 'requests': len(request_seen)}


def paired_success_delta(pairs: list[dict[str, Any]]) -> float | None:
    if not pairs or any(type(p.get('nativePassed')) is not bool or type(p.get('candidatePassed')) is not bool for p in pairs):
        return None
    return sum(int(p['candidatePassed']) - int(p['nativePassed']) for p in pairs)/len(pairs)


def evaluate_trial(pairs: list[dict[str, Any]], capabilities: list[dict[str, Any]],
                   objective: dict[str, Any], expected_pairs: int | None = None,
                   expected_capabilities: int | None = None) -> dict[str, str]:
    def answer(decision: str, reason: str) -> dict[str, str]:
        return {'decision': decision, 'reason': reason}
    if not pairs or (expected_pairs is not None and len(pairs) != expected_pairs):
        return answer('inconclusive', 'planned denominator incomplete')
    if paired_success_delta(pairs) is None:
        return answer('inconclusive', 'missing quality outcome')
    if any(p.get('criticalViolation') is True for p in pairs):
        return answer('observe-only', 'critical violation')
    if any(p.get('foldRequired') is True and p.get('foldApplied') is not True for p in pairs):
        return answer('inconclusive', 'optimization not exercised')
    if any(p.get('evidencePassed') is not True for p in pairs):
        return answer('review-needed', 'required evidence failed or unmeasured')
    if any(p['candidatePassed'] is not True for p in pairs):
        return answer('review-needed', 'candidate task failure; retain first-attempt details')
    if expected_capabilities is not None and len(capabilities) != expected_capabilities:
        return answer('inconclusive', 'capability denominator incomplete')
    if not capabilities or any(c.get('eligible') is not True or c.get('passed') is not True for c in capabilities):
        return answer('inconclusive', 'capability unproven')
    if objective.get('known') is not True:
        return answer('quality-qualified-cost-unknown', 'quality is not cost proof')
    change, minimum = objective.get('relativeChange'), objective.get('minImprovement')
    if not isinstance(change, (int, float)) or not isinstance(minimum, (int, float)):
        return answer('inconclusive', 'missing preregistered objective')
    if objective.get('metric') not in ('logical-input', 'wall-time', 'monetary-cost'):
        return answer('inconclusive', 'use a separate preregistered protocol for a quality-first objective')
    if change > -minimum:
        return answer('history-only', 'no demonstrated objective improvement')
    return answer('limited-balanced-trial', 'small canary only; no default change and no noninferiority claim')
