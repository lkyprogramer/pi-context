#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, sys
from pathlib import Path

root=Path(__file__).resolve().parents[1]
errors=[]; checks=0

def ok(cond,msg):
    global checks
    checks+=1
    if not cond: errors.append(msg)

required=['README.md','00-executive-summary.md','12-final-verdict-and-claim-policy.md','AI-START-HERE.md','findings/findings.json','tasks/TASK-INDEX.json','compliance/spec-compliance.json','BUILD-INFO.json']
for rel in required: ok((root/rel).is_file(),f'missing {rel}')

for p in root.rglob('*.json'):
    try: json.loads(p.read_text(encoding='utf-8')); ok(True,f'json {p}')
    except Exception as e: ok(False,f'invalid json {p.relative_to(root)}: {e}')

findings=json.loads((root/'findings/findings.json').read_text())
tasks=json.loads((root/'tasks/TASK-INDEX.json').read_text())
fids=[x['id'] for x in findings]; tids=[x['id'] for x in tasks]
ok(len(fids)==len(set(fids)),'duplicate finding IDs')
ok(len(tids)==len(set(tids)),'duplicate task IDs')
byid={x['id']:x for x in tasks}
for t in tasks:
    ok((root/t['document']).is_file(),f"missing task doc {t['id']}")
    for d in t['dependsOn']: ok(d in byid,f"unknown dependency {t['id']}->{d}")
for f in findings:
    for t in f['remediationTasks']: ok(t in byid,f"unknown remediation {f['id']}->{t}")
# DAG
ind={k:0 for k in byid}; out={k:[] for k in byid}
for t in tasks:
    for d in t['dependsOn']: ind[t['id']]+=1; out[d].append(t['id'])
q=[k for k,v in ind.items() if v==0]; seen=0
while q:
    n=q.pop(); seen+=1
    for x in out[n]:
        ind[x]-=1
        if ind[x]==0:q.append(x)
ok(seen==len(tasks),'task graph contains cycle')
# Links
link_re=re.compile(r'\[[^\]]+\]\(([^)]+)\)')
for p in root.rglob('*.md'):
    for target in link_re.findall(p.read_text(encoding='utf-8')):
        if '://' in target or target.startswith('#') or target.startswith('mailto:'): continue
        target=target.split('#',1)[0]
        if not target: continue
        ok((p.parent/target).resolve().exists(),f'broken link {p.relative_to(root)} -> {target}')
# Manifest when present
manifest=root/'MANIFEST.sha256'
if manifest.exists():
    for line in manifest.read_text().splitlines():
        if not line.strip(): continue
        digest,rel=line.split('  ',1); p=root/rel
        ok(p.exists(),f'manifest missing {rel}')
        if p.exists(): ok(hashlib.sha256(p.read_bytes()).hexdigest()==digest,f'manifest mismatch {rel}')

if errors:
    print(f'FAIL: {len(errors)} errors / {checks} checks')
    print('\n'.join(errors))
    sys.exit(1)
print(f'PASS: {checks} checks / files: {sum(1 for p in root.rglob("*") if p.is_file())}')
