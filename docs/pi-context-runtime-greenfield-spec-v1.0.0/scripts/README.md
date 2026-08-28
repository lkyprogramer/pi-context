# Artifact and autonomous-task scripts

## Artifact validation

```bash
python3 -m pip install -r scripts/requirements.txt
python3 scripts/validate_contract_consistency.py
python3 scripts/validate_task_graph.py
python3 scripts/generate_indexes.py
python3 scripts/validate_artifacts.py
python3 scripts/generate_manifest.py
sha256sum -c MANIFEST.sha256
```

## Autonomous task control

The committed artifact contains `tasks/task-status.template.jsonl`. On first use:

```bash
python3 scripts/taskctl.py init
```

This creates the uncommitted local state file `.pcr/task-status.jsonl`. The future implementation repository must add `.pcr/` to `.gitignore` in T01. Commands:

```bash
python3 scripts/taskctl.py next
python3 scripts/taskctl.py parallel-ready --json
python3 scripts/taskctl.py check-ready T01
python3 scripts/taskctl.py claim T01 --owner "$PCR_AGENT_ID"
python3 scripts/taskctl.py seal-evidence T01
python3 scripts/taskctl.py verify-evidence T01
python3 scripts/taskctl.py record-commit T01 HEAD
python3 scripts/taskctl.py block T01 --reason "contract conflict"
python3 scripts/taskctl.py unblock T01
```

`record-commit` writes task completion to the local `.pcr` state and to `refs/notes/pi-context-runtime-tasks`; it does not dirty a committed file.

## 恢复与并行

`init` 会在新 worktree 中从 `refs/notes/pi-context-runtime-tasks` 恢复已完成任务；`parallel-ready` 只返回依赖完成且写集合两两不相交的任务。
