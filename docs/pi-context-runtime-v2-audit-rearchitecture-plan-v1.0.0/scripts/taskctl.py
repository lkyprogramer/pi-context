#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, os, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
INDEX=json.loads((ROOT/'tasks/TASK-INDEX.json').read_text())
STATUS=ROOT/'.pcr/task-status.json'

def load():
    if not STATUS.exists():
        STATUS.parent.mkdir(parents=True,exist_ok=True)
        STATUS.write_text((ROOT/'tasks/task-status.template.json').read_text())
    return json.loads(STATUS.read_text())
def save(s): STATUS.write_text(json.dumps(s,indent=2)+'\n')
def task(tid): return next(x for x in INDEX if x['id']==tid)
def ready(tid,s): return all(s['tasks'][d]['state']=='committed' for d in task(tid)['dependsOn'])
def main():
    p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='cmd',required=True)
    sub.add_parser('next')
    q=sub.add_parser('check-ready'); q.add_argument('id')
    q=sub.add_parser('claim'); q.add_argument('id'); q.add_argument('--owner',required=True)
    q=sub.add_parser('seal-evidence'); q.add_argument('id')
    q=sub.add_parser('verify-evidence'); q.add_argument('id')
    q=sub.add_parser('record-commit'); q.add_argument('id'); q.add_argument('commit')
    a=p.parse_args(); s=load()
    if a.cmd=='next':
        for x in INDEX:
            if s['tasks'][x['id']]['state'] in {'ready','blocked'} and ready(x['id'],s): print(x['id']); return
        print('none'); return
    if a.cmd=='check-ready':
        if not ready(a.id,s): raise SystemExit(f'{a.id} dependencies not committed')
        print('ready'); return
    if a.cmd=='claim':
        if not ready(a.id,s): raise SystemExit('not ready')
        st=s['tasks'][a.id]
        if st.get('owner') not in {None,a.owner}: raise SystemExit('already claimed')
        st.update(state='claimed',owner=a.owner); save(s); print('claimed'); return
    ev=ROOT/'artifacts/task-evidence'/a.id
    if a.cmd=='seal-evidence':
        if not ev.exists(): raise SystemExit('evidence dir missing')
        files={}
        for f in sorted(ev.rglob('*')):
            if f.is_file() and f.name!='evidence.json': files[str(f.relative_to(ev))]=hashlib.sha256(f.read_bytes()).hexdigest()
        (ev/'evidence.json').write_text(json.dumps({'task':a.id,'files':files},indent=2)+'\n'); print('sealed'); return
    if a.cmd=='verify-evidence':
        m=json.loads((ev/'evidence.json').read_text())
        for rel,d in m['files'].items():
            if hashlib.sha256((ev/rel).read_bytes()).hexdigest()!=d: raise SystemExit(f'hash mismatch {rel}')
        print('verified'); return
    if a.cmd=='record-commit':
        commit=subprocess.check_output(['git','rev-parse',a.commit],text=True).strip()
        s['tasks'][a.id].update(state='committed',commit=commit); save(s)
        ev.mkdir(parents=True,exist_ok=True); (ev/'commit.txt').write_text(commit+'\n'); print(commit)
if __name__=='__main__': main()
