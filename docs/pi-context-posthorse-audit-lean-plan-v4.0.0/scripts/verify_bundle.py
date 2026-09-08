#!/usr/bin/env python3
"""Validate this documentation bundle offline; does not validate the product implementation."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--no-manifest', action='store_true', help='Authoring check before manifest is generated')
    args = parser.parse_args()
    root = args.root.resolve()
    errors: list[str] = []
    checks = 0
    def check(ok: bool, label: str) -> None:
        nonlocal checks
        checks += 1
        if not ok: errors.append(label)
    def read_json(path: str):
        try:
            return json.loads((root / path).read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            check(False, f'{path}: {exc}')
            return None
    files = sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    for p in files:
        check(p.stat().st_size > 0, f'Empty file: {p.relative_to(root)}')
        check(not p.is_symlink(), f'Symlink not permitted: {p.relative_to(root)}')
        if p.suffix == '.json':
            try: json.loads(p.read_text(encoding='utf-8')); check(True, 'JSON parsed')
            except (ValueError, UnicodeError) as exc: check(False, f'JSON {p}: {exc}')
    check((root/'VALIDATION.md').is_file(), 'VALIDATION.md missing')
    check((root/'CONTRACTS.md').is_file(), 'CONTRACTS.md missing')
    tasks = read_json('tasks/index.json') or []
    findings = read_json('findings.json') or []
    if isinstance(findings, dict): findings = findings.get('findings', [])
    fids = {x['id'] for x in findings}
    ids = {t['id'] for t in tasks}
    check(ids == {f'T{i:02d}' for i in range(1,13)}, 'Expected T01..T12 exactly')
    check(len(tasks) == len(ids), 'Duplicate task IDs')
    check(len(fids) == len(findings) == 16, 'Expected 16 unique findings')
    covered = set()
    visiting, visited = set(), set()
    by_id = {t['id']:t for t in tasks}
    def visit(tid: str) -> bool:
        if tid in visiting: return False
        if tid in visited: return True
        visiting.add(tid)
        for dep in by_id[tid]['dependsOn']:
            if dep not in by_id or not visit(dep): return False
        visiting.remove(tid); visited.add(tid)
        return True
    for t in tasks:
        check(set(t['dependsOn']).issubset(ids), f'{t["id"]}: unknown dependencies')
        check(set(t['findings']).issubset(fids), f'{t["id"]}: unknown findings')
        covered.update(t['findings'])
        p = root / t['document']
        check(p.is_file(), f'{t["id"]}: task document missing')
        if not p.is_file(): continue
        text = p.read_text(encoding='utf-8')
        for term in ['## 文件边界', '## 输入与输出', '## 第一个RED', '## 实施步骤',
                     '## 边界测试', '## 执行命令', '## 验收与失败处置']:
            check(term in text, f'{t["id"]}: {term} missing')
        check('```ts' in text and 'expect(' in text, f'{t["id"]}: concrete RED missing')
        check(t['test'] in t['allowedFiles'], f'{t["id"]}: test outside allowed scope')
        for name in t['allowedFiles']:
            check(name in text, f'{t["id"]}: index/document file mismatch {name}')
        check(not re.search(r'\b(TODO|TBD|FIXME)\b', text), f'{t["id"]}: placeholder')
    check(covered == fids, 'Some findings have no task')
    check(all(visit(t) for t in ids), 'Task graph cycle or missing dependency')
    for p in root.rglob('*.md'):
        text = p.read_text(encoding='utf-8')
        fences = [line for line in text.splitlines() if re.match(r'^\s*```', line)]
        check(len(fences)%2==0, f'Unclosed Markdown fence: {p.relative_to(root)}')
        for target in re.findall(r'\]\(([^\s)]+)(?:\s+"[^"]*")?\)', text):
            if target.startswith(('http:', 'https:', 'mailto:', '#')): continue
            target = unquote(target.split('#',1)[0])
            if not target: continue
            q = (p.parent / target).resolve()
            check(q.is_relative_to(root) and q.exists(), f'Broken local link: {p.relative_to(root)} -> {target}')
    try:
        with (root/'compliance/previous-plan.csv').open(encoding='utf-8-sig',newline='') as f:
            rows=list(csv.DictReader(f))
        check({r['id'] for r in rows} == {f'C{i:02d}' for i in range(32)}, 'Previous plan not exactly C00..C31')
        check(len(rows)==32, 'Previous plan duplicate rows')
    except (OSError, KeyError) as exc: check(False, f'Compliance CSV: {exc}')
    build = read_json('BUILD-INFO.json') or {}
    tree = read_json('evidence/zip-tree-verification.json') or {}
    check(tree.get('treeMatches') is True, 'Input source tree verification unavailable')
    check(tree.get('githubTree') == build.get('gitTree'), 'Input tree mismatch')
    check(tree.get('zipSha256') == build.get('sourceZipSha256'), 'Source ZIP hash mismatch')
    for p in (root/'experiments/examples').glob('*.json'):
        d=read_json(str(p.relative_to(root))) or {}
        oracle=d.get('oracle', {})
        matches=[x for x in d.get('sourceEntries', []) if x.get('id')==oracle.get('sourceEntryId')]
        check(len(matches)==1, f'{p.name}: source witness missing/duplicate')
        if len(matches)==1:
            check(hashlib.sha256(matches[0]['text'].encode()).hexdigest()==oracle.get('sourceSha256'), f'{p.name}: witness hash mismatch')
        for a in d.get('assertions',[]):
            if a['kind']=='file-unchanged':
                content=d.get('workspaceFiles',{}).get(a['path'])
                check(content is not None, f'{p.name}: unchanged file absent')
                if content is not None: check(hashlib.sha256(content.encode()).hexdigest()==a['originalSha256'], f'{p.name}: unchanged-file hash mismatch')
        if d.get('mode')=='coding':
            check(bool(d.get('workspaceFiles')), f'{p.name}: empty coding workspace')
            check(bool(d.get('assertions')), f'{p.name}: no environment assertions')
    cfg=read_json('experiments/personal-canary.template.json') or {}
    check(cfg.get('liveEnabled') is False, 'Template must not start a live run')
    check(cfg.get('maxPrimaryArmRuns')==cfg.get('independentTasksRequired',0)*cfg.get('repeats',0)*len(cfg.get('arms',[])), 'Run count inconsistent')
    check(cfg.get('maxTotalRequests')==cfg.get('maxPrimaryArmRuns',0)*cfg.get('maxRequestsPerArm',0), 'Request cap inconsistent')
    sys.path.insert(0,str(root/'scripts'))
    try:
        from recompute_report import summarize
        metrics=read_json('evidence/pairs-metrics.json')
        result=summarize(metrics)
        check(result['planned']==300, 'Expected 300 original attempts')
        check(result['complete4']==289, 'Expected 289 complete four-arm pairs')
        check(result['primaryComplete']==290, 'Expected 290 complete primary pairs')
        check(result['arms']['b2']['recovery']['passRate'] is None, 'Untested recovery must be null')
        check(result['arms']['b2']['probeInputMedianComplete4']==514, 'B2 input median mismatch')
        check(result['arms']['b0']['probeInputMedianComplete4']==499, 'B0 input median mismatch')
        check(abs(result['complete4Comparison']['medianPairedInputDelta']+0.09345794392523364)<1e-12, 'Paired delta mismatch')
    except (OSError, ValueError, KeyError, TypeError, ImportError) as exc: check(False, f'Reaggregation: {exc}')
    if not args.no_manifest:
        p=root/'MANIFEST.sha256'
        check(p.is_file(), 'MANIFEST.sha256 missing')
        if p.is_file():
            entries={}
            for line in p.read_text(encoding='utf-8').splitlines():
                parts=line.split('  ',1)
                check(len(parts)==2, 'Malformed manifest line')
                if len(parts)!=2: continue
                digest,name=parts; target=(root/name).resolve()
                check(name not in entries, f'Duplicate manifest path {name}')
                entries[name]=digest
                check(target.is_relative_to(root), f'Unsafe manifest path {name}')
                check(target.is_file(), f'Missing manifest file {name}')
                if target.is_relative_to(root) and target.is_file():
                    check(hashlib.sha256(target.read_bytes()).hexdigest()==digest, f'Manifest digest mismatch {name}')
            expected={str(p.relative_to(root)) for p in files if p.name!='MANIFEST.sha256'}
            check(set(entries)==expected, 'Manifest does not cover all non-manifest files')
    print(json.dumps({'result':'PASS' if not errors else 'FAIL','checks':checks,'files':len(files),
                      'tasks':len(tasks),'findings':len(findings),'errors':errors},ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=='__main__':
    raise SystemExit(main())
