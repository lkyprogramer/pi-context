#!/usr/bin/env python3
"""Recompute the supplied v5 8-task report. Offline; never calls a provider.
The legacy billedTokens field is a recorded token proxy, NOT monetary cost.
"""
from __future__ import annotations
import argparse, json, math, statistics
from pathlib import Path

def numeric(x):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) and x>=0

def metric(rows, name):
    known=[r for r in rows if numeric(r['baseline'].get(name)) and numeric(r['candidate'].get(name))]
    a=[r['baseline'][name] for r in known];b=[r['candidate'][name] for r in known]
    rel=[(y-x)/x for x,y in zip(a,b) if x>0]
    return {'paired_known':len(known),'planned':len(rows),'baseline_sum':sum(a) if a else None,
      'candidate_sum':sum(b) if b else None,'baseline_median':statistics.median(a) if a else None,
      'candidate_median':statistics.median(b) if b else None,
      'paired_relative_delta_median':statistics.median(rel) if rel else None,
      'ratio_of_sums_minus_one':sum(b)/sum(a)-1 if sum(a)>0 else None,
      'all_attempts_covered':False} # original report overwrites retries; cannot establish coverage

def summarize(rows):
    discordant={'both_pass':0,'baseline_only':0,'candidate_only':0,'both_not_pass':0}
    delta=[]
    for r in rows:
        a=r['baseline'].get('taskPassed') is True and r['baseline'].get('status')=='complete'
        b=r['candidate'].get('taskPassed') is True and r['candidate'].get('status')=='complete'
        key='both_pass' if a and b else 'baseline_only' if a else 'candidate_only' if b else 'both_not_pass'
        discordant[key]+=1;delta.append(int(b)-int(a))
    return {'n':len(rows),'quality_counts_as_recorded':discordant,
      'quality_paired_mean_as_recorded':statistics.mean(delta) if delta else None,
      'critical_checks_measured':sum(r['candidate'].get('criticalViolation') is not None for r in rows),
      'recorded_token_proxy':metric(rows,'billedTokens'),'recorded_wall_ms':metric(rows,'wallMs'),
      'monetary_cost':metric(rows,'monetaryCost')}

def recompute(rows):
    if not isinstance(rows,list):raise ValueError('pairs must be a list')
    seen=set()
    for r in rows:
        key=(r['taskId'],r['repetition'])
        if key in seen:raise ValueError(f'duplicate pair {key}')
        seen.add(key)
        for arm in ['baseline','candidate']:
            if not isinstance(r.get(arm),dict):raise ValueError(f'missing {arm}')
    normal=[r for r in rows if r['taskId']!='J05'];c2=[r for r in rows if r['taskId']=='J05']
    return {'kind':'offline-recompute-not-a-new-benchmark',
      'warning':'B2 label was not verified as balanced; J05 is a capability challenge, not fair quality evidence.',
      'all8_as_reported':summarize(rows),'ordinary_without_J05':summarize(normal),
      'J05_capability_only':summarize(c2),'unique_tasks':len({r['taskId'] for r in rows}),
      'repetition_labels':sorted({r['repetition'] for r in rows}),
      'balanced_effect_verified':False,'new_publication_claim':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('pairs',type=Path);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();result=recompute(json.loads(a.pairs.read_text(encoding='utf-8')))
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
