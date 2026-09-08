#!/usr/bin/env python3
"""Offline aggregation only. Does not re-score answers or call a provider."""
from __future__ import annotations
import argparse, hashlib, json, math, statistics
from collections import Counter
from pathlib import Path
from typing import Any
ARMS = ('b0', 'b1', 'b2', 'f0')

def number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def med(values: list[float]) -> float | None:
    return statistics.median(values) if values else None

def arm(row: dict, key: str) -> dict:
    value = row.get(key)
    return value if isinstance(value, dict) else {}

def success(value: dict) -> int:
    # A missing or failed attempt cannot be counted as success.
    return int(value.get('ok') is True and value.get('closedLoopSuccess') == 1)

def recovery(values: list[dict]) -> dict:
    counts = Counter(str(v.get('recoveryStatus', 'missing')) for v in values)
    tested = sum(v.get('recoveryStatus') in ('ok', 'failed') and
                 number(v.get('recoveryDenominator')) and v['recoveryDenominator'] > 0 for v in values)
    passed = sum(v.get('recoveryStatus') == 'ok' and
                 number(v.get('recoveryDenominator')) and v['recoveryDenominator'] > 0 for v in values)
    return {'statuses': dict(counts), 'testedArms': tested, 'passedArms': passed,
            'passRate': passed / tested if tested else None,
            'conclusion': 'not-tested' if not tested else 'observed-subset-only'}

def compare(rows: list[dict], base: str = 'b0', cand: str = 'b2') -> dict:
    observed = [r for r in rows if number(arm(r, base).get('probeInputTokens')) and
                number(arm(r, cand).get('probeInputTokens'))]
    positive = [r for r in observed if arm(r, base)['probeInputTokens'] > 0]
    deltas = [(arm(r, cand)['probeInputTokens'] - arm(r, base)['probeInputTokens']) /
              arm(r, base)['probeInputTokens'] for r in positive]
    a = [arm(r, base)['probeInputTokens'] for r in observed]
    b = [arm(r, cand)['probeInputTokens'] for r in observed]
    return {'n': len(rows), 'observedInputPairs': len(observed),
            'relativeDeltaPairs': len(positive), 'medianPairedInputDelta': med(deltas),
            'medianAbsoluteInputSaving': med([x-y for x,y in zip(a,b)]),
            'lastInputSumBase': sum(a), 'lastInputSumCandidate': sum(b),
            'lastInputSumDelta': sum(b)/sum(a)-1 if sum(a)>0 else None,
            'reportedSuccessBase': sum(success(arm(r,base)) for r in rows),
            'reportedSuccessCandidate': sum(success(arm(r,cand)) for r in rows),
            'meanReportedSuccessDelta': sum(success(arm(r,cand))-success(arm(r,base)) for r in rows)/len(rows) if rows else None,
            'discordance': dict(Counter(f'{success(arm(r,base))}/{success(arm(r,cand))}' for r in rows))}

def summarize(data: dict) -> dict:
    rows = data.get('pairs')
    if not isinstance(rows, list): raise ValueError('pairs must be an array')
    ids = [r.get('id') for r in rows if isinstance(r, dict)]
    if len(ids) != len(rows) or any(not isinstance(i,str) or not i for i in ids):
        raise ValueError('Every pair needs a nonempty id')
    if len(ids) != len(set(ids)): raise ValueError('Duplicate pair id')
    complete = [r for r in rows if all(arm(r,a).get('ok') is True for a in ARMS)]
    primary = [r for r in rows if arm(r,'b0').get('ok') is True and arm(r,'b2').get('ok') is True]
    results = {'kind': 'offline-reaggregation-no-rescoring',
               'planned': len(rows), 'complete4': len(complete), 'primaryComplete': len(primary),
               'complete4Comparison': compare(complete), 'primaryCompleteComparison': compare(primary),
               'intentToTreatReportedScores': compare(rows), 'arms': {}, 'families': {},
               'warnings': ['Scores inherited from the existing grader, not corrected.',
                            'Input fields are last-request observations, not full task/currency cost.',
                            'No claim of superiority or non-inferiority follows from this summary.']}
    for a in ARMS:
        good=[arm(r,a) for r in rows if arm(r,a).get('ok') is True]
        fs=[arm(r,a) for r in complete]
        def m(key): return med([v[key] for v in fs if number(v.get(key))])
        results['arms'][a]={'completed':len(good),'failedOrMissing':len(rows)-len(good),
           'reportedSuccessAllCompleted':sum(success(v) for v in good),
           'reportedSuccessComplete4':sum(success(v) for v in fs),
           'summaryTokensMedianComplete4':m('summaryTokens'),
           'probeInputMedianComplete4':m('probeInputTokens'),
           'probeOutputMedianComplete4':m('probeOutputTokens'),
           'compactLatencyMedianComplete4':m('compactLatencyMs'),
           'probeBuckets':dict(Counter(v.get('probeBucket','missing') for v in good)),
           'recovery':recovery(good)}
    for family in sorted({str(r.get('family','missing')) for r in rows}):
        results['families'][family]=compare([r for r in complete if str(r.get('family','missing'))==family])
    results['summaryMarkerRejectedArms']=[{'id':r['id'],'arm':a,'family':r.get('family')}
         for r in rows for a in ARMS if arm(r,a).get('ok') is True and arm(r,a).get('probeBucket')=='summary']
    return results

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True); parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:
        blob=args.input.read_bytes(); data=json.loads(blob); result=summarize(data)
        result['inputArtifactSha256']=hashlib.sha256(blob).hexdigest()
        result['sourceReportSha256']=data.get('sourceReportSha256',result['inputArtifactSha256'])
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
        print(json.dumps({'planned':result['planned'],'complete4':result['complete4'],
                          'primaryComplete':result['primaryComplete'],'output':str(args.output)},ensure_ascii=False))
    except (OSError, ValueError, TypeError) as e:
        parser.exit(2,f'recompute failed: {e}\n')
if __name__=='__main__': main()
