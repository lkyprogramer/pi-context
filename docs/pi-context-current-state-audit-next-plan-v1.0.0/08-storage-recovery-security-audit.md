# Storage、Recovery 与 Security 审计

## Storage

SQLite/CAS/Saga 模块设计比旧版可靠，但 current CI 的跨进程 durability/crash tests 未通过。必须修复 runner 后再判断实现，而不是扩大 timeout 掩盖问题。

## Scope

- pointer catalog 必须按 workspace/session/leaf/lineage/model 读取；
- `lastPointers`、`lastCursor` 不能作为并发 API；
- dataRoot 的 per-session/per-workspace 策略必须裁决；
- cross-scope read 必须在同一个 live run 中实际尝试并拒绝。

## Security

`must-omit` 应覆盖：

- summary/checkpoint；
- Probe/LLM response；
- tool visible result；
- FTS snippet/search/read；
- Pi JSONL details；
- telemetry/log/run bundle；
- base64/URL/分片/无句点 secret 变体。

当前 0/30 只证明 B1 summary 没包含一个字面字符串。
