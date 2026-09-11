"""Validate audit package structure, internal links, DAG, and optional manifest."""
from pathlib import Path
import hashlib, json, re, sys
ROOT=Path(__file__).resolve().parents[1]
checks=0;errors=[]
def check(value,label):
    global checks
    checks+=1
    if not value:errors.append(label)
files=[p for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
for p in files:
    check(p.stat().st_size>0,f'empty:{p.relative_to(ROOT)}')
    if p.suffix=='.json':
        try:json.loads(p.read_text());check(True,'json')
        except Exception as e:check(False,f'json:{p}:{e}')
    if p.suffix=='.md':
        s=p.read_text()
        check(len(re.findall(r'^```',s,re.M))%2==0,f'code-fence:{p}')
        for u in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)',s):
            if re.match(r'\w+://',u) or u.startswith('#') or '<' in u:continue
            target=(p.parent/u.split('#')[0]).resolve()
            check(target.exists(),f'link:{p.relative_to(ROOT)}->{u}')
index=json.loads((ROOT/'tasks/index.json').read_text())
ids={t['id'] for t in index}
check(len(ids)==10,'task-count/unique')
visiting=set();visited=set()
def walk(i):
    if i in visited:return
    check(i not in visiting,f'cycle:{i}')
    if i in visiting:return
    visiting.add(i)
    t=next(t for t in index if t['id']==i)
    for dep in t['dependsOn']:
        check(dep in ids,f'dep:{i}->{dep}')
        if dep in ids:walk(dep)
    visiting.remove(i);visited.add(i)
for t in index:
    walk(t['id']);p=ROOT/'tasks'/f"{t['id']}.md"
    check(p.exists(),f'task-file:{t["id"]}')
    s=p.read_text()
    for needle in ['## 接口合同','## 非目标','## TDD第一条红测','## 最小实施顺序','## 负例与边界','## 完成验证','```ts']:
        check(needle in s,f'task-section:{t["id"]}:{needle}')
findings=json.loads((ROOT/'audit/findings.json').read_text())
check(len(findings)==12,'finding-count')
for f in findings:
    for t in f['tasks']:check(t in ids,f'finding-target:{f["id"]}:{t}')
probes=json.loads((ROOT/'evidence/source-probes.json').read_text())['probes']
check(len(probes)==15,'probe-count')
check(all(p['executed'] for p in probes),'probe-executed')
check(sum(p.get('defect') is True for p in probes)==13,'counterexample-count')
check(sum(p.get('regressionFixed') is True for p in probes)==2,'positive-count')
scenarios=json.loads((ROOT/'testing/scenarios.json').read_text())['scenarios']
check(len(scenarios)==12,'scenario-count')
check(sum(s['kind']=='quality' for s in scenarios)==8,'quality-count')
check(sum(s['kind']=='capability' for s in scenarios)==2,'capability-count')
manifest=ROOT/'MANIFEST.sha256'
if manifest.exists():
    covered=set()
    for line in manifest.read_text().splitlines():
        digest,name=line.split('  ',1);covered.add(name);p=ROOT/name
        check(p.is_file(),f'manifest-missing:{name}')
        if p.is_file():check(hashlib.sha256(p.read_bytes()).hexdigest()==digest,f'manifest-hash:{name}')
    expected={str(p.relative_to(ROOT)) for p in files if p!=manifest}
    check(covered==expected,'manifest-coverage')
print(json.dumps({'checks':checks,'errors':errors,'files':len(files),'tasks':len(index),'findings':len(findings),'scenarios':len(scenarios)},ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
