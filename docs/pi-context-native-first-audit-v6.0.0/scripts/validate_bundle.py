#!/usr/bin/env python3
"""Portable standard-library validation of this documentation package.
It validates artifacts, not the product's implementation or live performance.
No output files are written inside the bundle.
"""
from __future__ import annotations
import argparse, ast, hashlib, json, re, sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT=Path(__file__).resolve().parents[1]
checks=0;errors=[]
def check(cond,msg):
 global checks
 checks+=1
 if not cond:errors.append(msg)
def read_json(p):
 try:
  result=json.loads(p.read_text(encoding='utf8'));check(True,str(p));return result
 except Exception as e:check(False,f'{p}: {e}');return None

def validate(root,allow_missing_manifest=False):
 files=sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
 check(bool(files),'empty bundle')
 for p in files:
  name=p.relative_to(root).as_posix()
  check(p.stat().st_size>0,f'empty: {name}')
  check(not p.is_symlink(),f'symlink: {name}')
  if p.suffix=='.json':read_json(p)
  if p.suffix=='.py':
   try:ast.parse(p.read_text(encoding='utf8'));check(True,name)
   except SyntaxError as e:check(False,f'Python syntax {name}: {e}')
  if p.suffix=='.md':
   text=p.read_text(encoding='utf8');fences=re.findall(r'^\s*```',text,re.M)
   check(len(fences)%2==0,f'unbalanced fence: {name}')
   # Only ordinary inline Markdown links; external hyperlinks are not probed online.
   for target in re.findall(r'\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)',text):
    if urlparse(target).scheme or target.startswith('#'):continue
    clean=unquote(target.split('#',1)[0]);dest=(p.parent/clean).resolve()
    check(dest.is_relative_to(root.resolve()),f'link outside bundle: {name}: {target}')
    check(dest.exists(),f'broken link: {name}: {target}')
 tasks=read_json(root/'tasks/index.json')['tasks'];ids={t['id'] for t in tasks}
 check(len(tasks)==12 and len(ids)==12,'12 unique tasks required')
 visiting=set();visited=set()
 def visit(id):
  if id in visiting:raise ValueError('task cycle')
  if id in visited:return
  visiting.add(id)
  t=next(x for x in tasks if x['id']==id)
  for dep in t['dependsOn']:
   if dep not in ids:raise ValueError(f'missing dependency {dep}')
   visit(dep)
  visiting.remove(id);visited.add(id)
 try:
  for id in ids:visit(id)
  check(True,'DAG')
 except ValueError as e:check(False,str(e))
 for t in tasks:
  p=root/'tasks'/f"{t['id']}.md";check(p.exists(),f'missing task {t["id"]}')
  text=p.read_text(encoding='utf8') if p.exists() else ''
  for heading in ['文件边界','交付接口','第一条行为 RED','实施顺序','必测负例及边界','验收与结束']:
   check(heading in text,f'{t["id"]} lacks {heading}')
  check(t['testFile'] in t['allowedFiles'],f'{t["id"]} test not allowed')
  for path in t['allowedFiles']:
   check(not path.startswith('/') and '..' not in Path(path).parts,f'unsafe task path {path}')
   check(f'`{path}`' in text,f'{t["id"]} missing path {path} in prose')
  check(bool(re.search(r'```ts\n.*?\b(?:it|test)\s*\(',text,re.S)),f'{t["id"]} lacks concrete red test')
  check(not re.search(r'\b(?:TODO|TBD|FIXME)\b',text),f'{t["id"]} placeholder')
 findings=read_json(root/'audit/findings.json')
 check(len(findings)==20,'20 findings expected')
 check(len({x['id'] for x in findings})==20,'duplicate finding')
 for f in findings:check(f['task'] in ids,f'{f["id"]} unmapped task')
 # Task cards and findings must agree on who closes what.
 closed={}
 for t in tasks:
  for fid in t.get('closes',[]):closed.setdefault(fid,set()).add(t['id'])
 for f in findings:
  check(f['task'] in closed.get(f['id'],set()),f'{f["id"]} task {f["task"]} does not list it in closes')
 check(set(closed)=={f['id'] for f in findings},'closes references unknown or misses findings')
 compliance=read_json(root/'audit/compliance.json')
 # This artifact is a list of the original T01..T26 requirements.
 check(len(compliance)==26,'26 original tasks required')
 for row in compliance:
  nxt=row.get('next')
  if nxt and nxt not in ('-','无'):
   for tid in re.split(r'[,/ ]+',nxt):
    if tid:check(tid in ids,f'compliance {row.get("id")} next {tid} unknown')
 scen=read_json(root/'testing/scenarios.json')
 check(len(scen['cases'])==12,'12 scenarios required')
 case_ids={c['id'] for c in scen['cases']}
 check(set(scen['qualityIds'])|set(scen['capabilityIds'])|set(scen['mechanicalIds'])==case_ids,'scenario group coverage')
 for c in scen['cases']:
  check(set(c.get('arms',[]))<=set(scen['arms']),f'{c["id"]} unknown arm')
 check(sum(len(c.get('arms',[]))*c.get('reps',0) for c in scen['cases'])==scen['maxEpisodes'],'episode count contract (sum arms*reps)')
 harness=root/'testing/harness'
 hcases=read_json(harness/'cases.json')
 hids={c['id'] for c in hcases['cases']} if isinstance(hcases,dict) else {c['id'] for c in hcases}
 check(hids<=case_ids,'harness cases.json ids not in scenarios')
 for cid in scen['capabilityIds']:
  check((harness/'cases'/cid/'TASK.md').exists(),f'missing harness TASK.md for {cid}')
 for cid in scen['qualityIds']:
  check(cid in hids,f'quality case {cid} absent from harness cases.json')
 # Harness scripts must at least parse; behaviour is validated by E-phase tasks, not here.
 import shutil,subprocess
 node=shutil.which('node');bash=shutil.which('bash')
 for p in files:
  name=p.relative_to(root).as_posix()
  if p.suffix=='.mjs' and node:
   r=subprocess.run([node,'--check',str(p)],capture_output=True,text=True);check(r.returncode==0,f'node --check {name}: {r.stderr.strip()[:200]}')
  if p.suffix=='.sh' and bash:
   r=subprocess.run([bash,'-n',str(p)],capture_output=True,text=True);check(r.returncode==0,f'bash -n {name}: {r.stderr.strip()[:200]}')
   check(p.stat().st_mode&0o111!=0,f'not executable: {name}')
 probes=read_json(root/'evidence/source-probes.json')['results']
 check(len(probes)==15,'15 probes required')
 check(not any('probeError' in p for p in probes),'probe execution errors')
 ident=read_json(root/'evidence/source-identity.json')
 check(ident['computedGitTree']==ident['expectedGitTree'] and ident['match'],'source tree identity mismatch')
 manifest=root/'MANIFEST.sha256'
 if manifest.exists():
  rows=[]
  for line in manifest.read_text().splitlines():
   sha,name=line.split('  ',1);rows.append(name);p=root/name
   check(p.exists(),f'manifest missing {name}')
   if p.exists():check(hashlib.sha256(p.read_bytes()).hexdigest()==sha,f'manifest hash {name}')
  wanted={p.relative_to(root).as_posix() for p in files if p!=manifest}
  check(set(rows)==wanted,'manifest coverage')
  check(len(rows)==len(set(rows)),'duplicate manifest path')
 else:check(allow_missing_manifest,'manifest absent')
 return {'passed':not errors,'checks':checks,'files':len(files),'tasks':len(tasks),'findings':len(findings),'scenarios':len(scen['cases']),'errors':errors}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--allow-missing-manifest',action='store_true');a=p.parse_args()
 result=validate(ROOT,a.allow_missing_manifest);print(json.dumps(result,ensure_ascii=False,indent=2));sys.exit(0 if result['passed'] else 1)
