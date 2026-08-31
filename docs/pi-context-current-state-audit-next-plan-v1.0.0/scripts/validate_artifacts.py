#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, sys
from collections import defaultdict, deque
from pathlib import Path

root=Path(__file__).resolve().parents[1]
errors=[]; checks=0
required=['README.md','00-executive-summary.md','14-final-verdict.md','plans/00-master-plan.md','tasks/TASK-INDEX.json','findings/findings.json','SOURCE-INDEX.md']
for p in required:
    checks+=1
    if not (root/p).exists(): errors.append(f'missing:{p}')

tasks=json.loads((root/'tasks/TASK-INDEX.json').read_text())
ids={t['id'] for t in tasks}
checks+=len(tasks)
if len(tasks)!=51: errors.append(f'task-count:{len(tasks)}')
for t in tasks:
    if not (root/t['document']).exists(): errors.append(f'missing-task-doc:{t["id"]}')
    for d in t['dependsOn']:
        if d not in ids: errors.append(f'bad-dep:{t["id"]}:{d}')

ind={i:0 for i in ids}; graph=defaultdict(list)
for t in tasks:
    for d in t['dependsOn']:
        graph[d].append(t['id']); ind[t['id']]+=1
q=deque([i for i,n in ind.items() if n==0]); seen=[]
while q:
    n=q.popleft(); seen.append(n)
    for m in graph[n]:
        ind[m]-=1
        if ind[m]==0:q.append(m)
checks+=1
if len(seen)!=len(ids): errors.append('task-dag-cycle')

findings=json.loads((root/'findings/findings.json').read_text())
checks+=len(findings)
if len({f['id'] for f in findings})!=len(findings): errors.append('duplicate-finding')
for f in findings:
    for t in f.get('verificationTasks',[]):
        if t not in ids: errors.append(f'finding-bad-task:{f["id"]}:{t}')

# local markdown links
for md in root.rglob('*.md'):
    text=md.read_text(encoding='utf-8')
    for link in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
        if '://' in link or link.startswith('#') or link.startswith('mailto:'): continue
        target=(md.parent/link.split('#',1)[0]).resolve()
        checks+=1
        if not target.exists(): errors.append(f'bad-link:{md.relative_to(root)}:{link}')

# placeholder scan
for p in root.rglob('*'):
    if not p.is_file() or p.name in {'MANIFEST.sha256'}: continue
    if p.suffix not in {'.md','.json','.py','.mmd','.csv'}: continue
    text=p.read_text(encoding='utf-8',errors='ignore')
    for bad in ['TBD_'+'PLACEHOLDER','TODO_'+'PLACEHOLDER','<'+'target-module'+'>','lorem'+' ipsum']:
        checks+=1
        if bad in text: errors.append(f'placeholder:{p.relative_to(root)}:{bad}')

if errors:
    print(f'FAIL: {len(errors)} errors / {checks} checks')
    print('\n'.join(errors[:100])); sys.exit(1)
print(f'PASS: {checks} checks / files: {sum(1 for p in root.rglob("*") if p.is_file())} / tasks: {len(tasks)} / findings: {len(findings)}')
