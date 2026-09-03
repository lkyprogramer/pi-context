#!/usr/bin/env python3
from pathlib import Path
import json,re,sys
root=Path(__file__).resolve().parents[1]
head=json.loads((root/'evidence/current-head.json').read_text())['head']
errors=[]
for rel in ['README.md','00-executive-summary.md','12-final-verdict-and-claim-policy.md']:
    txt=(root/rel).read_text()
    if head[:7] not in txt and head not in txt: errors.append(rel+':missing-head')
if errors: raise SystemExit('\n'.join(errors))
print('status-sync: ok')
