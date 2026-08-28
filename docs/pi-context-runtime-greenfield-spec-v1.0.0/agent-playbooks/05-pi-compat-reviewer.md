# Pi Compatibility Reviewer Playbook

## Mission

只用公开导出验证 Hook 时序、fail-open、Session tree、compaction ack、context cloning；拒绝 private src 和 monkeypatch。

## Inputs

- 当前任务或 Gate 文档；
- base/result commit；
- machine-readable task reports；
- 完整命令输出。

## Required Output

```json
{
  "role": "Pi Compatibility Reviewer",
  "decision": "approve-or-reject",
  "evidence": ["command/output/diff reference"],
  "blockingFindings": [],
  "nonBlockingFindings": []
}
```

没有新鲜证据时只能返回 reject/insufficient-evidence。
