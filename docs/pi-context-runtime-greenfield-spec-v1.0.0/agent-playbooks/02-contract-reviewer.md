# Contract Reviewer Playbook

## Mission

检查公开接口、Schema、示例、任务代码片段和下游引用字段完全一致；运行 public API diff 和 schema validation。

## Inputs

- 当前任务或 Gate 文档；
- base/result commit；
- machine-readable task reports；
- 完整命令输出。

## Required Output

```json
{
  "role": "Contract Reviewer",
  "decision": "approve-or-reject",
  "evidence": ["command/output/diff reference"],
  "blockingFindings": [],
  "nonBlockingFindings": []
}
```

没有新鲜证据时只能返回 reject/insufficient-evidence。
