from __future__ import annotations

import math
import random
from dataclasses import dataclass
from statistics import median
from typing import Callable, Iterable, Sequence


def relative_delta(candidate: float, baseline: float) -> float:
    return (candidate - baseline) / max(abs(baseline), 1.0)


def paired_differences(baseline: Sequence[float], candidate: Sequence[float]) -> list[float]:
    if len(baseline) != len(candidate) or not baseline:
        raise ValueError("paired samples must be non-empty and equal length")
    return [c - b for b, c in zip(baseline, candidate, strict=True)]


def percentile(values: Sequence[float], p: float) -> float:
    if not values:
        raise ValueError("values must be non-empty")
    if not 0.0 <= p <= 1.0:
        raise ValueError("p must be in [0,1]")
    xs = sorted(values)
    pos = (len(xs) - 1) * p
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return xs[lo]
    return xs[lo] * (hi - pos) + xs[hi] * (pos - lo)


def paired_bootstrap_ci(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    statistic: Callable[[Sequence[float]], float] = median,
    samples: int = 10_000,
    seed: int = 20260827,
    alpha: float = 0.05,
) -> tuple[float, float, float]:
    diffs = paired_differences(baseline, candidate)
    rng = random.Random(seed)
    boots: list[float] = []
    n = len(diffs)
    for _ in range(samples):
        draw = [diffs[rng.randrange(n)] for _ in range(n)]
        boots.append(float(statistic(draw)))
    estimate = float(statistic(diffs))
    return estimate, percentile(boots, alpha / 2), percentile(boots, 1 - alpha / 2)


def mcnemar_table(baseline: Sequence[bool], candidate: Sequence[bool]) -> dict[str, int]:
    if len(baseline) != len(candidate) or not baseline:
        raise ValueError("paired samples must be non-empty and equal length")
    out = {"both_pass": 0, "baseline_only": 0, "candidate_only": 0, "both_fail": 0}
    for b, c in zip(baseline, candidate, strict=True):
        if b and c:
            out["both_pass"] += 1
        elif b:
            out["baseline_only"] += 1
        elif c:
            out["candidate_only"] += 1
        else:
            out["both_fail"] += 1
    return out


@dataclass(frozen=True)
class W1GateInput:
    integrity_pass: bool
    quality_ci_lower: float
    quality_margin: float
    ingress_token_median_delta: float
    ingress_token_ci_upper: float
    hook_p95_ms: float
    recall_at_5: float
    recall_precision: float
    silence_rate: float
    recall_quality_ci_lower: float
    recall_quality_margin: float
    recall_needed_success_delta: float
    realized_net_median: float


def evaluate_w1_gate(x: W1GateInput) -> str:
    if not x.integrity_pass or x.quality_ci_lower < -x.quality_margin:
        return "stop"
    ingress = (
        x.ingress_token_median_delta <= -0.20
        and x.ingress_token_ci_upper <= -0.10
        and x.hook_p95_ms <= 75.0
    )
    recall = (
        x.recall_at_5 >= 0.90
        and x.recall_precision >= 0.75
        and x.silence_rate >= 0.90
        and x.recall_quality_ci_lower >= -x.recall_quality_margin
        and x.recall_needed_success_delta > 0.0
    )
    if ingress and recall and x.realized_net_median > 0.0:
        return "proceed-to-w2"
    if ingress:
        return "keep-reducers-only"
    return "keep-recovery-only" if x.realized_net_median >= 0.0 else "stop"
