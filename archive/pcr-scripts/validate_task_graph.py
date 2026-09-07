#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys
from collections import defaultdict, deque
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
GRAPH=ROOT/'tasks/task-graph.json'
STATUS=ROOT/'tasks/task-status.template.jsonl'

def fail(msg: str): raise AssertionError(msg)
def load(path: Path): return json.loads(path.read_text(encoding='utf-8'))

def section_bullets(text: str, heading: str) -> list[str]:
    if heading not in text: return []
    part=text.split(heading,1)[1]
    part=part.split('\n## ',1)[0]
    return [m.group(1).strip('`') for m in re.finditer(r'^- (.+)$',part,re.M) if m.group(1).strip()!='无']

def main() -> int:
    checks=0
    graph=load(GRAPH); tasks=graph.get('tasks')
    if not isinstance(tasks,list): fail('tasks must be list')
    ids=[x.get('id') for x in tasks]; expected=[f'T{i:02d}' for i in range(1,49)]
    if ids!=expected: fail(f'IDs must be T01..T48: {ids}')
    by={x['id']:x for x in tasks}; checks+=2
    indegree={x:0 for x in ids}; edges=defaultdict(list)
    for task in tasks:
        tid=task['id']; deps=task.get('dependsOn')
        if task.get('wave') not in {f'W{i}' for i in range(6)}: fail(f'{tid}: bad wave')
        if not isinstance(deps,list) or len(deps)!=len(set(deps)): fail(f'{tid}: bad/duplicate deps')
        for dep in deps:
            if dep not in by or dep==tid: fail(f'{tid}: bad dep {dep}')
            if int(dep[1:]) >= int(tid[1:]): fail(f'{tid}: dependency must precede task: {dep}')
            indegree[tid]+=1; edges[dep].append(tid)
        expected_file=f"tasks/{tid}-{task['slug']}.md"
        if task.get('taskFile')!=expected_file or not (ROOT/expected_file).is_file(): fail(f'{tid}: task file mismatch')
        text=(ROOT/expected_file).read_text(encoding='utf-8')
        for heading in ['## 1. 先决条件','## 2. 必读规格与 ADR','## 3. 文件边界','## 4. 接口合同','### Consumes','### Produces','## 5. 明确不做','## 6. TDD 执行步骤','## 7. 验收清单','## 8. Reviewer Focus']:
            if heading not in text: fail(f'{expected_file}: missing {heading}')
            checks+=1
        for step in range(1,9):
            if f'**Step {step}：' not in text: fail(f'{expected_file}: missing Step {step}')
            checks+=1
        pre=text.split('## 2. 必读规格与 ADR',1)[0]
        linked=re.findall(r'\[`(T\d{2})`\]\(T\d{2}-[^)]+\.md\)',pre)
        if linked!=deps: fail(f'{tid}: linked deps {linked} != {deps}')
        if task.get('primarySymbol') not in text: fail(f'{tid}: primary symbol missing')
        if '唯一允许写入集合' not in text or 'Task Evidence' not in text: fail(f'{tid}: scope/evidence section missing')
        if 'sourceDigest' not in text or 'Git Note' not in text: fail(f'{tid}: autonomous evidence protocol missing')
        if '不得依赖包外 Skill' not in text: fail(f'{tid}: external independence missing')
        if re.search(r'\b(?:TBD|TODO)\b|implement later|fill in details|similar to Task',text,re.I): fail(f'{tid}: placeholder')
        allowed=section_bullets(text,'### 唯一允许写入集合')
        for required in [f'artifacts/task-evidence/{tid}/red.txt',f'artifacts/task-evidence/{tid}/green.txt',f'artifacts/task-evidence/{tid}/full-gate.txt',f'artifacts/task-evidence/{tid}.json']:
            if required not in allowed: fail(f'{tid}: evidence path not allowed: {required}')
        checks+=9
    q=deque(x for x in ids if indegree[x]==0); visited=[]
    while q:
        x=q.popleft(); visited.append(x)
        for y in edges[x]:
            indegree[y]-=1
            if indegree[y]==0:q.append(y)
    if len(visited)!=48: fail('cycle detected')
    status=[json.loads(x) for x in STATUS.read_text(encoding='utf-8').splitlines() if x.strip()]
    if [x.get('taskId') for x in status]!=ids or any(x.get('status')!='pending' for x in status): fail('status template mismatch')
    actual=sorted(p.relative_to(ROOT).as_posix() for p in (ROOT/'tasks').glob('T[0-9][0-9]-*.md'))
    expected_files=sorted(x['taskFile'] for x in tasks)
    if actual!=expected_files: fail('orphan/missing task docs')
    task_index=load(ROOT/'tasks/TASK-INDEX.json')
    expected_waves={wave:[task['id'] for task in tasks if task['wave']==wave] for wave in sorted({task['wave'] for task in tasks})}
    if task_index.get('taskCount')!=48 or task_index.get('waves')!=expected_waves or task_index.get('tasks')!=tasks:
        fail('TASK-INDEX.json drift; run scripts/generate_indexes.py')
    checks+=5
    print(f'PASS: task graph consistency ({checks} checks, 48 tasks, 6 waves)')
    return 0
if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as exc:
        print(f'FAIL: {exc}',file=sys.stderr); raise
