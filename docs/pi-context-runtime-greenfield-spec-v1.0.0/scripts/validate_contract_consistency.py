#!/usr/bin/env python3
from __future__ import annotations
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=['system','authenticated-user','untrusted-user','trusted-tool','untrusted-tool','external-content','agent-derived']
AUTH=['none','inform','propose','act']
ZONES=['stable-prefix','append-only-history','volatile-augmentation','active-turn']
SECTIONS=['runtime-preamble','hard-directives','stable-continuity','historical-tail','continuity-delta','directory','retrieval-page','runtime-warning','active-turn']
PI_SHA='938109e7259068ff736dbba3bed14c81af25abbe';PI_VERSION='0.84.3'
def fail(x):raise AssertionError(x)
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def enums(node,key):
    out=[]
    if isinstance(node,dict):
        props=node.get('properties')
        if isinstance(props,dict) and isinstance(props.get(key),dict) and isinstance(props[key].get('enum'),list):out.append(props[key]['enum'])
        for v in node.values():out.extend(enums(v,key))
    elif isinstance(node,list):
        for v in node:out.extend(enums(v,key))
    return out
def union_values(text,name):
    m=re.search(rf'export type {re.escape(name)}\s*=\s*(.*?);',text,re.S)
    if not m:fail(f'missing TS union {name}')
    return re.findall(r'"([^"]+)"',m.group(1))
def main():
    checks=0;build=load(ROOT/'BUILD-INFO.json');lock=load(ROOT/'compat/pi.lock.json')
    if build['piBaseline']!={'repository':'earendil-works/pi','commit':PI_SHA,'packageVersion':PI_VERSION}:fail('BUILD Pi baseline drift')
    if lock['baseline']!={'version':PI_VERSION,'commit':PI_SHA}:fail('compat baseline drift')
    checks+=2
    ref=(ROOT/'reference/contracts.ts').read_text(encoding='utf-8')
    for name,expected in [('SourceClass',SOURCE),('ActionAuthority',AUTH),('CacheZone',ZONES),('MaterializedSectionKind',SECTIONS)]:
        if union_values(ref,name)!=expected:fail(f'{name} drift')
        checks+=1
    schema_docs=[load(p) for p in (ROOT/'schemas').glob('*.schema.json')]
    for key,expected in [('sourceClass',SOURCE),('authority',AUTH),('cacheZone',ZONES),('kind',SECTIONS)]:
        found=enums(schema_docs,key)
        relevant=[]
        for x in found:
            if set(x).issubset(set(expected)) and len(x)>1: relevant.append(x)
        for x in relevant:
            if x!=expected:fail(f'{key} enum drift: {x}')
            checks+=1
    material=load(ROOT/'schemas/materialized-view.schema.json')
    section_enum=material['properties']['sections']['items']['properties']['kind']['enum']
    zone_enum=material['properties']['sections']['items']['properties']['cacheZone']['enum']
    if section_enum!=SECTIONS or zone_enum!=ZONES:fail('materialized section enum drift')
    checks+=2
    blueprint=load(ROOT/'reference/package-blueprint.json')
    if blueprint.get('pi',{}).get('extensions')!=['./dist/extension.js']:fail('package must have one extension entry')
    peers=blueprint.get('peerDependencies',{})
    for key in ['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','typebox']:
        if peers.get(key)!='*':fail(f'Pi package peer must follow public package guidance: {key}')
    checks+=4
    paths=[]
    for group in ['tasks','plans','reference','pi-adapter','agent-playbooks']:
        paths.extend((ROOT/group).rglob('*'))
    paths.extend(ROOT.glob('[0-9][0-9]-*.md'))
    forbidden={'bodyHash':'outputHash','providerOverhead':'providerReservedTokens/outputReserveTokens','ctx.contextRuntime':'Pi context hook','dsh-context-runtime':'pi-context-runtime','@deepseek-ai/':'public Pi API','exact-active-turn':'active-turn'}
    for path in paths:
        if not path.is_file() or path.suffix not in {'.md','.ts','.json','.yaml','.yml'}:continue
        if path.name in {'validate_contract_consistency.py'}:continue
        text=path.read_text(encoding='utf-8')
        for term,replacement in forbidden.items():
            if term in text:fail(f'{path.relative_to(ROOT)}: legacy term {term}; use {replacement}')
            checks+=1
    print(f'PASS: contract consistency ({checks} checks)')
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:print(f'FAIL: {exc}',file=sys.stderr);raise
