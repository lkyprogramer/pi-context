#!/usr/bin/env python3
"""Summarize paired eval records without turning missing data into success.

The binomial bound concerns the event 'any adverse repetition in a complete
independent task cluster'. It is NOT a general confidence interval for the net
success-rate difference, and this utility never authorizes publication.
"""
from __future__ import annotations
import argparse
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


def clopper_upper(k: int, n: int, alpha: float = .05) -> float | None:
    if not (isinstance(k,int) and isinstance(n,int) and 0 <= k <= n and 0 < alpha < 1):
        raise ValueError('invalid binomial inputs')
    if n == 0:
        return None
    if k == n:
        return 1.0
    if k == 0:
        return 1 - alpha ** (1 / n)
    def cdf(p: float) -> float:
        if p <= 0: return 1.0
        if p >= 1: return 0.0
        logs=[math.lgamma(n+1)-math.lgamma(i+1)-math.lgamma(n-i+1)
              + i*math.log(p)+(n-i)*math.log1p(-p) for i in range(k+1)]
        top=max(logs)
        return math.exp(top)*math.fsum(math.exp(x-top) for x in logs)
    lo,hi=k/n,1.0
    for _ in range(90):
        mid=(lo+hi)/2
        if cdf(mid) > alpha: lo=mid
        else: hi=mid
    return (lo+hi)/2


def _number(value: Any, name: str) -> None:
    if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float))
                              or not math.isfinite(value) or value < 0):
        raise ValueError(f'{name} must be finite, nonnegative, or null')


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    kinds=set(); seen=set(); by_cluster: dict[str,list[dict[str,Any]]]=defaultdict(list)
    valid_status={'complete','timeout','blocked','failed','not-run'}
    for row in rows:
        if row.get('kind') not in {'real-run','synthetic-example'}:
            raise ValueError('kind must explicitly distinguish real-run from synthetic-example')
        kinds.add(row['kind'])
        for field in ('taskId','clusterId'):
            if not isinstance(row.get(field),str) or not row[field]:
                raise ValueError(f'missing {field}')
        rep=row.get('repetition')
        if isinstance(rep,bool) or not isinstance(rep,int) or rep<0:
            raise ValueError('repetition must be a nonnegative integer')
        key=(row['taskId'],rep)
        if key in seen: raise ValueError(f'duplicate pair: {key}')
        seen.add(key)
        if row.get('provenance') not in {'real-independent','adapted-real','synthetic'}:
            raise ValueError('invalid provenance')
        for side in ('baseline','candidate'):
            arm=row.get(side)
            if not isinstance(arm,dict) or arm.get('status') not in valid_status:
                raise ValueError(f'invalid {side} status')
            if arm.get('arm') not in {'B0','B1','B2','B3'}: raise ValueError('invalid arm')
            for field in ('taskPassed','criticalViolation'):
                if arm['status']=='complete':
                    if type(arm.get(field)) is not bool: raise ValueError(f'complete {side} requires boolean {field}')
                elif arm.get(field) is not None:
                    raise ValueError(f'noncomplete {side} must keep {field} null')
            _number(arm.get('wallMs'),'wallMs');_number(arm.get('monetaryCost'),'monetaryCost')
        by_cluster[row['clusterId']].append(row)
    if len(kinds)>1: raise ValueError('do not mix real runs and synthetic demonstrations')
    def complete(r: dict[str,Any]) -> bool:
        return all(r[s]['status']=='complete' for s in ('baseline','candidate'))
    pairs=[r for r in rows if complete(r)]
    clusters={k:v for k,v in by_cluster.items() if all(complete(r) for r in v)}
    adverse=sum(any(r['baseline']['taskPassed'] and not r['candidate']['taskPassed'] for r in v)
                for v in clusters.values())
    upper=clopper_upper(adverse,len(clusters))
    known=[r for r in rows if all(r[s].get('monetaryCost') is not None for s in ('baseline','candidate'))]
    money=None
    if rows and len(known)==len(rows):
        b=math.fsum(r['baseline']['monetaryCost'] for r in known)
        c=math.fsum(r['candidate']['monetaryCost'] for r in known)
        if b>0: money=100*(c-b)/b
    deltas=[100*(r['candidate']['wallMs']-r['baseline']['wallMs'])/r['baseline']['wallMs']
            for r in rows if r['baseline'].get('wallMs') is not None and r['baseline']['wallMs']>0
            and r['candidate'].get('wallMs') is not None]
    counts={'bothPass':0,'baselineOnly':0,'candidateOnly':0,'bothFail':0}
    for r in pairs:
        b,c=r['baseline']['taskPassed'],r['candidate']['taskPassed']
        counts['bothPass' if b and c else 'baselineOnly' if b else 'candidateOnly' if c else 'bothFail']+=1
    return {
        'kind':next(iter(kinds),'no-data'),
        'plannedPairs':len(rows),'completePairs':len(pairs),'incompletePairs':len(rows)-len(pairs),
        'plannedClusters':len(by_cluster),'completeClusters':len(clusters),
        'discordance':counts,'adverseClusters':adverse,
        'adverseClusterRateUpper95':upper,
        'twoPercentAdverseBoundSatisfied':upper is not None and upper<=.02,
        'inferenceScope':'conditional-on-complete-independent-task-clusters; any adverse repetition per cluster',
        'candidateCriticalViolations':sum(r['candidate']['criticalViolation'] for r in pairs),
        'knownCostPairs':len(known),'monetaryDeltaPct':money,
        'knownWallPairs':len(deltas),'medianWallDeltaPct':statistics.median(deltas) if deltas and len(deltas)==len(rows) else None,
        'resourceScope':'all planned pairs; unknown resource values prevent aggregate claims',
        'publicationClaimAllowed':False,
        'limitations':[
            'Does not authenticate manifests, sample independence, model identity, or oracle execution.',
            'Incomplete clusters are excluded from the conditional bound and remain in the planned denominator.',
            'The adverse-event upper bound is not a confidence interval for net paired success difference.',
            'Synthetic demonstration data cannot establish product performance.'
        ]
    }


def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('jsonl',type=Path)
    args=ap.parse_args()
    try:
        rows=[json.loads(s) for s in args.jsonl.read_text(encoding='utf-8').splitlines() if s.strip()]
        print(json.dumps(summarize(rows),ensure_ascii=False,indent=2,allow_nan=False))
        return 0
    except (OSError,ValueError,TypeError,KeyError) as exc:
        print(f'Invalid evaluation data: {exc}',file=sys.stderr)
        return 2

if __name__=='__main__':raise SystemExit(main())
