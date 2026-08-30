#!/usr/bin/env python3
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(); p.add_argument('command',choices=['list','close']); p.add_argument('id',nargs='?'); p.add_argument('--evidence'); a=p.parse_args()
path=ROOT/'findings/findings.json'; rows=json.loads(path.read_text())
if a.command=='list':
    for x in rows:
        if x['status']=='open': print(x['id'],x['severity'],x['title'])
else:
    if not a.id or not a.evidence or not (ROOT/a.evidence).exists(): raise SystemExit('close requires id and existing evidence')
    item=next(x for x in rows if x['id']==a.id); item['status']='closed'; item['closureEvidence']=a.evidence
    path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
