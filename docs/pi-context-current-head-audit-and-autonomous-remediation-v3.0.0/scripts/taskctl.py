#!/usr/bin/env python3
from pathlib import Path
import json, hashlib, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
INDEX={x['id']:x for x in json.loads((ROOT/'tasks/TASK-INDEX.json').read_text())}
STATE_PATH=ROOT/'.task-state.json'

def sha(p):
    h=hashlib.sha256();h.update(Path(p).read_bytes());return h.hexdigest()

def die(msg): raise SystemExit(msg)

def git(*args):
    return subprocess.check_output(['git',*args],text=True).strip()

def complete(task_id,evidence_path):
    if task_id not in INDEX: die('unknown-task')
    ev=json.loads(Path(evidence_path).read_text())
    if ev.get('taskId')!=task_id: die('task-id-mismatch')
    state=json.loads(STATE_PATH.read_text())
    for dep in INDEX[task_id]['dependsOn']:
        if state['tasks'][dep]['status']!='complete': die(f'dependency-not-complete:{dep}')
    if not ev.get('worktreeCleanBefore'): die('dirty-start')
    if git('rev-parse','HEAD')!=ev.get('headCommit'): die('head-mismatch')
    phases={c.get('phase') for c in ev.get('commands',[])}
    if 'green' not in phases or 'full-gate' not in phases: die('missing-green-or-full-gate')
    reds=[c for c in ev['commands'] if c.get('phase')=='red']
    if reds and all(c.get('exitCode')==0 for c in reds): die('red-did-not-fail')
    for c in ev['commands']:
        p=Path(c['logPath'])
        if not p.exists() or p.stat().st_size==0: die('missing-or-empty-log:'+str(p))
        if sha(p)!=c['logSha256']: die('log-hash-mismatch:'+str(p))
        if c['phase'] in {'green','full-gate','verification'} and c['exitCode']!=0: die('nonzero-'+c['phase'])
    for a in ev.get('artifacts',[]):
        p=Path(a['path'])
        if not p.exists() or sha(p)!=a['sha256']: die('artifact-invalid:'+str(p))
    if not ev.get('requirements') or not all(ev['requirements'].values()): die('requirements-not-met')
    if ev.get('review',{}).get('status')!='accepted': die('review-not-accepted')
    state['tasks'][task_id]={'status':'complete','evidence':str(Path(evidence_path).resolve()),'headCommit':ev['headCommit']}
    STATE_PATH.write_text(json.dumps(state,indent=2)+'\n')
    print('complete',task_id)

def main():
    if len(sys.argv)!=4 or sys.argv[1]!='complete':
        die('usage: taskctl.py complete Cxx evidence.json')
    complete(sys.argv[2],sys.argv[3])
if __name__=='__main__': main()
