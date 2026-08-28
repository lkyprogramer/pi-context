#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,re,sys
from pathlib import Path
from urllib.parse import unquote
import jsonschema,yaml
ROOT=Path(__file__).resolve().parents[1]
def fail(x):raise AssertionError(x)
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def fences(path):
    open_=None;count=0
    for line in path.read_text(encoding='utf-8').splitlines():
        s=line.lstrip()
        if not(s.startswith('```') or s.startswith('~~~')):continue
        mark=s[:3];open_=mark if open_ is None else (None if open_==mark else open_);count+=1
    if open_:fail(f'{path.relative_to(ROOT)}: unclosed fence')
    return count
def links(path):
    text=path.read_text(encoding='utf-8');count=0
    for m in re.finditer(r'(?<!!)\[[^\]]*\]\(([^)]+)\)',text):
        target=m.group(1).strip().split()[0].strip('<>')
        if not target or target.startswith(('http://','https://','mailto:','#','sandbox:','data:')):continue
        target=unquote(target.split('#',1)[0]); resolved=(path.parent/target).resolve()
        try:resolved.relative_to(ROOT.resolve())
        except ValueError:fail(f'{path.relative_to(ROOT)}: link escapes root {target}')
        if not resolved.exists():fail(f'{path.relative_to(ROOT)}: broken link {target}')
        count+=1
    return count
def config_semantics(path,doc):
    b=doc['budget'];s=doc['storage'];sem=doc['semantic'];checks=0
    if not 0<b['targetRatio']<b['softRatio']<b['hardRatio']<1:fail(f'{path.name}: ratio order')
    checks+=1
    if s['viewRetentionDays']>s['rawEvidenceRetentionDays']:fail(f'{path.name}: retention order')
    checks+=1
    if sem['enabled'] and not sem['verifierRequired']:fail(f'{path.name}: semantic verifier')
    if sem['background'] and not sem['enabled']:fail(f'{path.name}: background without semantic')
    checks+=2
    if doc['profile']=='security-strict' and doc['observation']['failurePolicy']!='fail-closed':fail('strict observation fail-closed')
    if doc['security']['strict'] and not doc['security']['actionGate']:fail('strict action gate')
    return checks+2
def manifest():
    p=ROOT/'MANIFEST.sha256'
    if not p.exists():return 0
    seen=set();checks=0
    for n,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
        if not line:continue
        m=re.fullmatch(r'([a-f0-9]{64})  (.+)',line)
        if not m:fail(f'manifest line {n}')
        expected,rel=m.groups();target=ROOT/rel
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest()!=expected:fail(f'manifest mismatch {rel}')
        if rel in seen:fail(f'manifest duplicate {rel}')
        seen.add(rel);checks+=1
    expected={x.relative_to(ROOT).as_posix() for x in ROOT.rglob('*') if x.is_file() and x!=p}
    if seen!=expected:fail(f'manifest coverage missing={sorted(expected-seen)} extra={sorted(seen-expected)}')
    return checks+1
def main():
    checks=0;files=sorted(x for x in ROOT.rglob('*') if x.is_file())
    if not files:fail('empty');checks+=1
    zero=[x.relative_to(ROOT).as_posix() for x in files if x.stat().st_size==0]
    if zero:fail(f'zero files {zero}')
    checks+=len(files)
    for path in files:
        if path.suffix=='.json':load(path);checks+=1
        elif path.suffix=='.jsonl':
            for line in path.read_text(encoding='utf-8').splitlines():
                if line.strip():json.loads(line);checks+=1
        elif path.suffix in {'.yaml','.yml'}:yaml.safe_load(path.read_text(encoding='utf-8'));checks+=1
    schemas={}
    for path in sorted((ROOT/'schemas').glob('*.schema.json')):
        doc=load(path);jsonschema.Draft202012Validator.check_schema(doc);schemas[path.name.removesuffix('.schema.json')]=doc;checks+=1
    for path in sorted((ROOT/'examples').glob('*.json')):
        if path.stem in schemas:jsonschema.Draft202012Validator(schemas[path.stem]).validate(load(path));checks+=1
    for filename,stem in {'telemetry-events.jsonl':'telemetry-event','benchmark-records.jsonl':'benchmark-record'}.items():
        val=jsonschema.Draft202012Validator(schemas[stem])
        for line in (ROOT/'examples'/filename).read_text(encoding='utf-8').splitlines():
            if line.strip():val.validate(json.loads(line));checks+=1
    val=jsonschema.Draft202012Validator(schemas['task-status'])
    for line in (ROOT/'tasks/task-status.template.jsonl').read_text(encoding='utf-8').splitlines():
        if line.strip():val.validate(json.loads(line));checks+=1
    val=jsonschema.Draft202012Validator(schemas['runtime-config'])
    for path in sorted((ROOT/'configs').glob('*.yaml')):
        doc=yaml.safe_load(path.read_text(encoding='utf-8'));val.validate(doc);checks+=1;checks+=config_semantics(path,doc)
    for path in sorted(ROOT.rglob('*.md')):checks+=fences(path);checks+=links(path)
    patterns=[re.compile(r'\bTBD\b'),re.compile(r'\bTODO\b'),re.compile(r'implement later',re.I),re.compile(r'fill in details',re.I),re.compile(r'similar to Task',re.I),re.compile(r'Write tests for the above',re.I)]
    for path in files:
        rel=path.relative_to(ROOT).as_posix()
        if rel.startswith('sources/user-provided/') or rel.startswith('scripts/'):continue
        if path.suffix not in {'.md','.ts','.mjs','.py','.json','.yaml','.yml'}:continue
        text=path.read_text(encoding='utf-8')
        for pat in patterns:
            if pat.search(text):fail(f'{rel}: placeholder {pat.pattern}')
            checks+=1
        if '/mnt/data/' in text:fail(f'{rel}: build path leak')
    counts={
      'numbered_docs':len(list(ROOT.glob('[0-9][0-9]-*.md'))),'adrs':len(list((ROOT/'adrs').glob('[0-9][0-9][0-9][0-9]-*.md'))),
      'tasks':len(list((ROOT/'tasks').glob('T[0-9][0-9]-*.md'))),'plans':len(list((ROOT/'plans').glob('*.md'))),
      'schemas':len(list((ROOT/'schemas').glob('*.schema.json'))),'configs':len(list((ROOT/'configs').glob('*.yaml'))),
      'examples_json':len(list((ROOT/'examples').glob('*.json'))),'diagrams':len(list((ROOT/'diagrams').glob('*.mmd'))),
      'checklists':len(list((ROOT/'checklists').glob('*.md'))),'pi_adapter_docs':len(list((ROOT/'pi-adapter').glob('*.md'))),
      'agent_playbooks':len(list((ROOT/'agent-playbooks').glob('*.md')))}
    expected={'numbered_docs':46,'adrs':22,'tasks':48,'plans':8,'schemas':23,'configs':5,'examples_json':23,'diagrams':16,'checklists':9,'pi_adapter_docs':13,'agent_playbooks':7}
    if counts!=expected:fail(f'count drift actual={counts} expected={expected}')
    checks+=len(expected)
    required=['README.md','BUILD-INFO.json','tasks/EXECUTION-PROTOCOL.md','tasks/task-graph.json','tasks/task-status.template.jsonl','plans/00-master-implementation-plan.md','compat/pi.lock.json','reference/contracts.ts','scripts/validate_artifacts.py','scripts/validate_contract_consistency.py','scripts/validate_task_graph.py','scripts/taskctl.py','scripts/generate_manifest.py','scripts/generate_indexes.py','FILE-INDEX.md','VALIDATION.md']
    for rel in required:
        if not (ROOT/rel).is_file():fail(f'missing required {rel}')
        checks+=1
    checks+=manifest()
    print(f'PASS: artifact validation ({checks} checks, {len(files)} files)')
    print(json.dumps(counts,ensure_ascii=False,sort_keys=True))
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:print(f'FAIL: {exc}',file=sys.stderr);raise
