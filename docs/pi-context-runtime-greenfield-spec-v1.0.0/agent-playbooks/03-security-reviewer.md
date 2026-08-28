# Security Reviewer Playbook

## Mission

从 source binding、authority non-escalation、secret、workspace isolation、cursor、egress/action chain 检查；不能只看关键词 detector。

## Inputs

- 当前任务或 Gate 文档；
- base/result commit；
- machine-readable task reports；
- 完整命令输出。

## Required Output

```json
{
  "role": "Security Reviewer",
  "decision": "approve-or-reject",
  "evidence": ["command/output/diff reference"],
  "blockingFindings": [],
  "nonBlockingFindings": []
}
```

没有新鲜证据时只能返回 reject/insufficient-evidence。
