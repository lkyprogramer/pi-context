"""Validate this pack: structure, internal links, task DAG, finding→task mapping, scenarios, manifest."""
from pathlib import Path
import hashlib, json, re, sys

ROOT = Path(__file__).resolve().parents[1]
checks = 0
errors = []


def check(value, label):
    global checks
    checks += 1
    if not value:
        errors.append(label)


files = [p for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
for p in files:
    check(p.stat().st_size > 0, f'empty:{p.relative_to(ROOT)}')
    if p.suffix == '.json':
        try:
            json.loads(p.read_text())
        except Exception as e:
            check(False, f'json:{p}:{e}')
    if p.suffix == '.md':
        s = p.read_text()
        check(len(re.findall(r'^```', s, re.M)) % 2 == 0, f'code-fence:{p}')
        for u in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', s):
            if re.match(r'\w+://', u) or u.startswith('#') or '<' in u:
                continue
            target = (p.parent / u.split('#')[0]).resolve()
            check(target.exists(), f'link:{p.relative_to(ROOT)}->{u}')

index = json.loads((ROOT / 'tasks/index.json').read_text())
ids = {t['id'] for t in index}
check(len(ids) == 7 and len(index) == 7, 'task-count/unique')
visiting, visited = set(), set()


def walk(i):
    if i in visited:
        return
    check(i not in visiting, f'cycle:{i}')
    if i in visiting:
        return
    visiting.add(i)
    t = next(t for t in index if t['id'] == i)
    for dep in t['dependsOn']:
        check(dep in ids, f'dep:{i}->{dep}')
        if dep in ids:
            walk(dep)
    visiting.remove(i)
    visited.add(i)


SECTIONS = ['## 文件范围', '## 接口合同', '## 非目标', '## TDD 第一条红测', '## 最小实施顺序', '## 负例与边界', '## 完成验证', '**验收：**', '**Review focus：**', '```ts', '```bash']
for t in index:
    walk(t['id'])
    p = ROOT / 'tasks' / f"{t['id']}.md"
    check(p.exists(), f'task-file:{t["id"]}')
    s = p.read_text()
    for needle in SECTIONS:
        check(needle in s, f'task-section:{t["id"]}:{needle}')
    for f in t['files']:
        check(f'`{f}`' in s or f in s, f'task-file-listed:{t["id"]}:{f}')
    check(t['narrow'].startswith('pnpm exec vitest run'), f'task-narrow:{t["id"]}')

findings = json.loads((ROOT / 'audit/findings.json').read_text())
check(len(findings) == 12, 'finding-count')
closed = set()
for f in findings:
    check(f['attribution'] in {'dev', 'test', 'process', 'ceiling'}, f'finding-attribution:{f["id"]}')
    check(f['severity'] in {'P0', 'P1', 'P2'}, f'finding-severity:{f["id"]}')
    for t in f['tasks']:
        check(t in ids, f'finding-target:{f["id"]}:{t}')
        closed.add(f['id'])
for t in index:
    for g in t.get('closes', []):
        check(any(f['id'] == g and t['id'] in f['tasks'] for f in findings), f'task-closes-consistent:{t["id"]}:{g}')
check(closed == {f['id'] for f in findings}, 'all-findings-have-task')

scen = json.loads((ROOT / 'testing/scenarios.json').read_text())
S = scen['scenarios']
check(len(S) == 15, 'scenario-count')
check(sum(s['lane'] == 'Q' for s in S) == 8, 'q-count')
check(sum(s['lane'] == 'C' for s in S) == 2, 'c-count')
check(sum(s['lane'] == 'W' for s in S) == 4, 'w-count')
check(sum(s['lane'] == 'X' for s in S) == 1, 'x-count')
lanes = scen['lanes']
planned = sum(len(lanes[s['lane']]['arms']) * lanes[s['lane']]['reps'] for s in S)
check(planned == scen['plannedEpisodes'] == 84, f'planned-episodes:{planned}')
check(scen['expectedPairs'] == 8 * lanes['Q']['reps'], 'expected-pairs')
check(scen['expectedRegimePairs'] == {'warm': 4 * lanes['W']['reps'], 'long': 1 * lanes['X']['reps']}, 'expected-regime-pairs')
check(scen['objective']['primary']['metric'] == 'fresh-input', 'primary-metric-frozen')
check(all(s['exactQuote'] for s in S if s['id'] in ('Q05', 'W-Q05', 'X01')), 'exact-quote-ids')

agg = json.loads((ROOT / 'evidence/run-aggregates.json').read_text())
check(len(agg['runs']) == 3, 'aggregate-runs')
for r in agg['runs']:
    check(r['git']['dirty'] is True, f'aggregate-dirty-flag:{r["runId"]}')
    check(r['decision']['decision'] == 'review-needed', f'aggregate-decision:{r["runId"]}')
    q = r['qualityArms']
    check(q['native']['episodes'] == 16 and q['balanced']['episodes'] == 16, f'aggregate-episodes:{r["runId"]}')
    check(q['balanced']['folds'] == 16 and q['balanced']['nativeCompactions'] == 0, f'aggregate-mechanism:{r["runId"]}')
    check(q['native']['unknownUsage'] == 0 and q['balanced']['unknownUsage'] == 0, f'aggregate-unknown:{r["runId"]}')

manifest = ROOT / 'MANIFEST.sha256'
if manifest.exists():
    covered = set()
    for line in manifest.read_text().splitlines():
        digest, name = line.split('  ', 1)
        covered.add(name)
        p = ROOT / name
        check(p.is_file(), f'manifest-missing:{name}')
        if p.is_file():
            check(hashlib.sha256(p.read_bytes()).hexdigest() == digest, f'manifest-hash:{name}')
    expected = {str(p.relative_to(ROOT)) for p in files if p != manifest}
    check(covered == expected, 'manifest-coverage')

print(json.dumps({'checks': checks, 'errors': errors, 'files': len(files), 'tasks': len(index), 'findings': len(findings), 'scenarios': len(S)}, ensure_ascii=False, indent=2))
sys.exit(1 if errors else 0)
