#!/usr/bin/env python3
from pathlib import Path
import json,csv,re,sys
root=Path(__file__).resolve().parents[1]
errors=[]
idx=json.loads((root/'tasks/TASK-INDEX.json').read_text())
ids=[x['id'] for x in idx]
if ids!=[f'C{i:02d}' for i in range(32)]: errors.append('task ids are not C00-C31')
for x in idx:
    if not (root/f"tasks/{x['id']}.md").exists(): errors.append('missing task '+x['id'])
    for dep in x['dependsOn']:
        if dep not in ids: errors.append(x['id']+' bad dep '+dep)
findings=json.loads((root/'findings/findings.json').read_text())
if len(findings)!=40: errors.append('finding count != 40')
for f in findings:
    if f['task'] not in ids: errors.append(f['id']+' bad task')
for p in root.rglob('*.md'):
    if any(seg in {'evidence','repo'} for seg in p.parts): continue
    txt=p.read_text(errors='replace')
    if re.search(r'\bTBD\b|implement later|fill in details',txt,re.I): errors.append(str(p.relative_to(root))+':placeholder')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'pack-validation: ok tasks={len(ids)} findings={len(findings)}')
