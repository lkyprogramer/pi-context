#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
index=json.loads((root/'tasks/TASK-INDEX.json').read_text())
state_path=root/'.task-state.json'

def load():
    if state_path.exists(): return json.loads(state_path.read_text())
    return {t['id']:{'status':'pending','owner':None} for t in index}
def save(s): state_path.write_text(json.dumps(s,indent=2)+'\n')
def ready(t,s): return s[t['id']]['status']=='pending' and all(s[d]['status']=='done' for d in t['dependsOn'])

def verify_evidence(task: str) -> None:
    evidence=root/f'artifacts/task-evidence/{task}/evidence.json'
    if not evidence.exists(): raise SystemExit('missing-evidence')
    try:
        payload=json.loads(evidence.read_text())
    except json.JSONDecodeError:
        raise SystemExit('evidence-invalid-json')
    if not isinstance(payload, dict) or payload == {}:
        raise SystemExit('empty-evidence')
    for key in ('schemaVersion','taskId','status','currentHead','red','green','fullGate','acceptanceAssertions','dirty'):
        if key not in payload:
            raise SystemExit(f'evidence-missing:{key}')
    red=payload.get('red')
    if not isinstance(red, dict) or red.get('exitCode') == 0:
        raise SystemExit('red-did-not-fail')

p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='cmd',required=True)
sub.add_parser('init'); sub.add_parser('next')
c=sub.add_parser('claim'); c.add_argument('task'); c.add_argument('--owner',required=True)
d=sub.add_parser('done'); d.add_argument('task'); d.add_argument('--owner',required=True)
v=sub.add_parser('verify'); v.add_argument('task'); v.add_argument('--owner')
a=p.parse_args(); s=load()
if a.cmd=='init': save(s); print(state_path)
elif a.cmd=='next':
    rows=[t['id'] for t in index if ready(t,s)]; print('\n'.join(rows) if rows else 'none')
elif a.cmd=='claim':
    t=next(x for x in index if x['id']==a.task)
    if not ready(t,s): raise SystemExit('not-ready')
    s[a.task]={'status':'claimed','owner':a.owner}; save(s); print(a.task)
elif a.cmd in ('done','verify'):
    if a.cmd=='done' or a.owner:
        if s[a.task].get('owner')!=a.owner: raise SystemExit('owner-mismatch')
    verify_evidence(a.task)
    if a.cmd=='done':
        s[a.task]={'status':'done','owner':a.owner}; save(s)
    print(a.task)
