# 报告与 Artifact 标准

## Run Manifest 必填

```json
{
  "runId": "...",
  "commit": "40-hex",
  "dirty": false,
  "sourceBundleSha256": "...",
  "corpus": {"version":"...","hash":"...","split":"locked-test"},
  "pi": {"version":"0.84.4","patchSha256":"..."},
  "extensionTarballSha256": "...",
  "provider": {"name":"...","model":"...","configHash":"..."},
  "environment": {"os":"...","node":"...","imageDigest":"..."},
  "arms": ["B0","B1","B2","F0"],
  "replicatePolicy": "...",
  "startedAt": "...",
  "completedAt": "..."
}
```

## 原始文件

- 每 arm Session JSONL；
- Store/Workspace manifests；
- stdout/stderr；
- request/response usage 与 Provider request IDs；
- compaction entries/details；
- probe outputs；
- tool calls/results；
- environment assertions；
- exclusions/retries/failures；
- scorer version与离线重评分输入。

## 报告分层

1. Executive decision；
2. Run identity；
3. Integrity；
4. Quality；
5. Efficiency；
6. Family/cluster breakdown；
7. Failure examples；
8. Limitations；
9. Allowed claims；
10. Artifact manifest/checksum。

## 禁止

- 只提交 Preview 不提交 Raw；
- 报告 HEAD 与数据 HEAD 不同；
- 在同一结论混合修复前/修复后 Run；
- 用“exact”“closed-loop”“seed”“live”命名代理指标；
- 将失败 Lane 的尝试写成任务已完成。
