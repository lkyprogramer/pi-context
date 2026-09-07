#!/usr/bin/env python3
"""Validate this DESIGN bundle, not the future pi-context implementation.

Checks local links, JSON syntax, the bundled schema subset, the task DAG,
requirements traceability, source identifiers, and declared scope of evidence.
No external URL availability or product runtime behavior is asserted.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from typing import Any


def check_schema(value: Any, schema: dict[str,Any], path: str='$') -> list[str]:
    """Validate the small JSON Schema subset used by this bundle (not a general validator)."""
    errors=[]
    allowed={'$schema','$id','title','description','type','properties','required','additionalProperties',
             'items','enum','const','minimum','maximum','minLength','maxLength','pattern','oneOf'}
    unsupported=set(schema)-allowed
    if unsupported: return [f'{path}: unsupported schema keywords {sorted(unsupported)}']
    if 'oneOf' in schema:
        matches=sum(not check_schema(value,s,path) for s in schema['oneOf'])
        if matches!=1: errors.append(f'{path}: expected exactly one schema alternative')
    types=schema.get('type')
    if types:
        def is_type(t: str) -> bool:
            return {'null':value is None,'boolean':type(value) is bool,'string':isinstance(value,str),
                    'integer':type(value) is int,'number':type(value) in (int,float),
                    'array':isinstance(value,list),'object':isinstance(value,dict)}.get(t,False)
        if not any(is_type(t) for t in ([types] if isinstance(types,str) else types)):
            return errors+[f'{path}: incorrect type, expected {types}']
    if 'const' in schema and (value!=schema['const'] or type(value)!=type(schema['const'])):
        errors.append(f'{path}: const mismatch')
    if 'enum' in schema and value not in schema['enum']: errors.append(f'{path}: enum mismatch')
    if type(value) in (int,float):
        if 'minimum' in schema and value<schema['minimum']:errors.append(f'{path}: below minimum')
        if 'maximum' in schema and value>schema['maximum']:errors.append(f'{path}: above maximum')
    if isinstance(value,str):
        if len(value)<schema.get('minLength',0):errors.append(f'{path}: string too short')
        if 'maxLength' in schema and len(value)>schema['maxLength']:errors.append(f'{path}: string too long')
        if 'pattern' in schema and re.search(schema['pattern'],value) is None:errors.append(f'{path}: pattern mismatch')
    if isinstance(value,dict):
        props=schema.get('properties',{})
        for name in schema.get('required',[]):
            if name not in value:errors.append(f'{path}.{name}: missing required field')
        if schema.get('additionalProperties') is False:
            for name in set(value)-set(props):errors.append(f'{path}.{name}: additional field forbidden')
        for name,sub in props.items():
            if name in value:errors.extend(check_schema(value[name],sub,f'{path}.{name}'))
    if isinstance(value,list) and 'items' in schema:
        for i,item in enumerate(value):errors.extend(check_schema(item,schema['items'],f'{path}[{i}]'))
    return errors


def topological(tasks: list[dict[str,Any]]) -> list[str]:
    ids=[t['id'] for t in tasks]
    if len(ids)!=len(set(ids)):raise ValueError('duplicate task id')
    deps={t['id']:set(t.get('dependsOn',[])) for t in tasks}
    for tid,parents in deps.items():
        if not parents<=set(ids):raise ValueError(f'{tid}: unknown dependencies')
    order=[]
    while deps:
        ready=sorted(k for k,v in deps.items() if not v)
        if not ready:raise ValueError('task dependency cycle')
        order.extend(ready)
        for k in ready:del deps[k]
        for v in deps.values():v.difference_update(ready)
    return order


def validate(root: Path) -> dict[str,Any]:
    errors=[];json_count=0;link_count=0
    required=['README.md','AI-START-HERE.md','SOURCE-INDEX.md','tasks/task-graph.json',
              'contracts/model.ts','contracts/config.schema.json','contracts/config.example.json',
              'contracts/requirements.json','evidence/VERIFICATION.md','fixtures/eval-pairs-example.jsonl']
    for p in required:
        if not (root/p).is_file():errors.append(f'missing: {p}')
    parsed={}
    for p in root.rglob('*.json'):
        try:parsed[str(p.relative_to(root))]=json.loads(p.read_text(encoding='utf-8'));json_count+=1
        except (OSError,ValueError) as exc:errors.append(f'{p.relative_to(root)}: {exc}')
    for p in root.rglob('*.jsonl'):
        try:
            for i,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
                if line.strip():json.loads(line)
        except (OSError,ValueError) as exc:errors.append(f'{p.relative_to(root)}: invalid JSONL: {exc}')
    order=[]
    try:
        tasks=parsed['tasks/task-graph.json']['tasks'];order=topological(tasks)
        for task in tasks:
            if task.get('status')!='planned':errors.append(f'{task["id"]}: this is a plan, not completed product work')
            if not (root/'tasks'/f'{task["id"]}.md').exists():errors.append(f'missing task card {task["id"]}')
        reqs=parsed['contracts/requirements.json'];reqids=set()
        for req in reqs:
            if req['id'] in reqids:errors.append(f'duplicate requirement {req["id"]}')
            reqids.add(req['id'])
            if not req.get('tasks') or not set(req['tasks'])<=set(order):errors.append(f'{req["id"]}: invalid traceability')
        errors.extend(check_schema(parsed['contracts/config.example.json'],parsed['contracts/config.schema.json']))
        sources=parsed['evidence/sources.json'];source_ids={x['id'] for x in sources}
        if len(source_ids)!=len(sources):errors.append('duplicate source id')
        for p in root.rglob('*.md'):
            text=p.read_text(encoding='utf-8')
            for sid in set(re.findall(r'\bS\d{2}\b',text)):
                if sid not in source_ids:errors.append(f'{p.relative_to(root)}: unknown source {sid}')
            outside=re.sub(r'```.*?```','',text,flags=re.S)
            for raw in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)',outside):
                target=raw.split(' "',1)[0].strip().strip('<>')
                parts=urlsplit(target)
                if parts.scheme or parts.netloc or not parts.path:continue
                link_count+=1
                dest=(p.parent/unquote(parts.path)).resolve()
                if not dest.is_relative_to(root.resolve()):errors.append(f'{p.relative_to(root)}: link escapes bundle: {target}')
                elif not dest.exists():errors.append(f'{p.relative_to(root)}: broken local link: {target}')
        probes=parsed['evidence/audit-probes-result.json']
        if probes.get('realPiHostExecuted') or probes.get('fullSuiteExecuted'):errors.append('audit scope incorrectly widened')
        if parsed['eval/smoke-plan.json']['status']!='planned-not-executed':errors.append('live plan incorrectly marked executed')
    except (KeyError,TypeError,ValueError) as exc:errors.append(str(exc))
    return {'kind':'design-bundle-validation','status':'passed' if not errors else 'failed',
            'productImplementationVerified':False,'jsonFilesChecked':json_count,
            'localLinksChecked':link_count,'taskOrder':order,'errors':errors,
            'limitations':['No external URL availability checked.','No product host integration or live model benchmark executed.']}


def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);ap.add_argument('--output',type=Path)
    args=ap.parse_args()
    try:report=validate(args.root)
    except OSError as exc:report={'kind':'design-bundle-validation','status':'failed','errors':[str(exc)]}
    text=json.dumps(report,ensure_ascii=False,indent=2)+'\n';print(text,end='')
    if args.output:args.output.write_text(text,encoding='utf-8')
    return 0 if report['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
