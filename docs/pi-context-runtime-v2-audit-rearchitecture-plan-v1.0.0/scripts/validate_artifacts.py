#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]; checks=0
for p in ROOT.rglob('*'):
    if not p.is_file() or p.name=='MANIFEST.sha256': continue
    checks+=1
    if p.stat().st_size==0: errors.append(f'zero-byte {p.relative_to(ROOT)}')
    if p.suffix=='.json':
        try: json.loads(p.read_text())
        except Exception as e: errors.append(f'json {p}: {e}')
    if p.suffix=='.md':
        text=p.read_text()
        if text.count('```')%2: errors.append(f'fence {p}')
        for banned in ['TBD','TODO','implement later','fill in details','Similar to Task']:
            if banned in text: errors.append(f'placeholder {banned} in {p.relative_to(ROOT)}')
index=json.loads((ROOT/'tasks/TASK-INDEX.json').read_text()); ids={x['id'] for x in index}
for x in index:
    checks+=1
    for d in x['dependsOn']:
        if d not in ids: errors.append(f'unknown dependency {x["id"]}->{d}')
    if not (ROOT/x['document']).exists(): errors.append(f'missing task doc {x["document"]}')
# cycle check
vis=set(); stack=set()
def dfs(t):
    if t in stack: errors.append(f'cycle {t}'); return
    if t in vis:return
    stack.add(t)
    for d in next(x for x in index if x['id']==t)['dependsOn']:dfs(d)
    stack.remove(t);vis.add(t)
for t in ids:dfs(t)
trace=json.loads((ROOT/'traceability.json').read_text())['findings']
findings=json.loads((ROOT/'findings/findings.json').read_text())
for f in findings:
    checks+=1
    if f['severity']=='P0' and not trace.get(f['id']): errors.append(f'unmapped P0 {f["id"]}')
if errors:
    print('\n'.join('ERROR '+e for e in errors));sys.exit(1)
print(f'PASS: {checks} checks; files={sum(1 for p in ROOT.rglob("*") if p.is_file())}; tasks={len(index)}; findings={len(findings)}')
