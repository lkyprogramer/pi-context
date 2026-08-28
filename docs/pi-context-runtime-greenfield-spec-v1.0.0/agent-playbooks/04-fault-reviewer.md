# Fault Reviewer Playbook

## Mission

对每个 durable step 标出 crash before/after，验证 recovery idempotence、host-ahead/runtime-ahead 和 orphan GC。

## Inputs

- 当前任务或 Gate 文档；
- base/result commit；
- machine-readable task reports；
- 完整命令输出。

## Required Output

```json
{
  "role": "Fault Reviewer",
  "decision": "approve-or-reject",
  "evidence": ["command/output/diff reference"],
  "blockingFindings": [],
  "nonBlockingFindings": []
}
```

没有新鲜证据时只能返回 reject/insufficient-evidence。
