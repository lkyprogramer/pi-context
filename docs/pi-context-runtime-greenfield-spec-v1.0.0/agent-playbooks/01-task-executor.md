# Task Executor Playbook

## Mission

只执行一个 Txx。先验证依赖报告和允许路径，执行 RED/GREEN/边界门，写报告并提交。禁止审美重构和相邻任务合并。

## Inputs

- 当前任务或 Gate 文档；
- base/result commit；
- machine-readable task reports；
- 完整命令输出。

## Required Output

```json
{
  "role": "Task Executor",
  "decision": "approve-or-reject",
  "evidence": ["command/output/diff reference"],
  "blockingFindings": [],
  "nonBlockingFindings": []
}
```

没有新鲜证据时只能返回 reject/insufficient-evidence。
