#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, subprocess, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
index={x['id']:x for x in json.loads((root/'tasks/TASK-INDEX.json').read_text())}
state_path=root/'.task-state.json'

def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(): return json.loads(state_path.read_text()) if state_path.exists() else {k:{'status':'pending','owner':None} for k in index}
def save(s): state_path.write_text(json.dumps(s,indent=2)+'\n')
def verify_evidence(tid, owner):
    p=root/f'artifacts/task-evidence/{tid}/evidence.json'
    if not p.exists(): raise SystemExit('missing-evidence')
    e=json.loads(p.read_text())
    required=['schemaVersion','taskId','status','currentHead','red','green','fullGate','acceptanceAssertions','findingsClosed','dirty']
    for k in required:
        if k not in e: raise SystemExit(f'evidence-missing:{k}')
    if e['schemaVersion']!=2 or e['taskId']!=tid or e['status']!='done' or e['dirty'] is not False: raise SystemExit('evidence-invalid')
    head=git('rev-parse','HEAD')
    if e['currentHead']!=head: raise SystemExit('stale-head')
    if git('status','--porcelain'): raise SystemExit('dirty-tree')
    for phase in ['red','green','fullGate']:
        r=e[phase]
        if phase=='red' and r['exitCode']==0: raise SystemExit('red-did-not-fail')
        if phase!='red' and r['exitCode']!=0: raise SystemExit(f'{phase}-failed')
    if not e['acceptanceAssertions'] or not all(x.get('ok') is True for x in e['acceptanceAssertions']): raise SystemExit('acceptance-failed')
    live_or_release=int(tid[1:])>=21
    if live_or_release and not e.get('runBundleHashes'): raise SystemExit('missing-run-bundle-hash')
    return e

p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='cmd',required=True)
sub.add_parser('init'); sub.add_parser('next')
c=sub.add_parser('claim'); c.add_argument('task'); c.add_argument('--owner',required=True)
d=sub.add_parser('done'); d.add_argument('task'); d.add_argument('--owner',required=True)
v=sub.add_parser('verify'); v.add_argument('task'); v.add_argument('--owner',required=True)
a=p.parse_args(); s=load()
if a.cmd=='init': save(s); print(state_path)
elif a.cmd=='next':
    ready=[tid for tid,t in index.items() if s[tid]['status']=='pending' and all(s[x]['status']=='done' for x in t['dependsOn'])]
    print('\n'.join(ready) if ready else 'none')
elif a.cmd=='claim':
    t=index[a.task]
    if s[a.task]['status']!='pending' or not all(s[x]['status']=='done' for x in t['dependsOn']): raise SystemExit('not-ready')
    s[a.task]={'status':'claimed','owner':a.owner}; save(s); print(a.task)
elif a.cmd in ('verify','done'):
    if s[a.task].get('owner')!=a.owner: raise SystemExit('owner-mismatch')
    verify_evidence(a.task,a.owner)
    if a.cmd=='done': s[a.task]={'status':'done','owner':a.owner}; save(s)
    print(a.task)
