# Storage、Recovery 与 Security 审计

## 已达到的能力

- Per-workspace SQLite 与 scope cursor；
- CAS bytes/hash/length 校验；
- wrong-cursor deny；
- Saga restart/reconcile；
- Durable compaction stage；
- Tool outcome admission 与 side-effect hard gate；
- Raw user turn 保底和 supersession state。

## 仍需完成

### Recall Lease 持久化

建议新增 `recall_lease` 表，并把 lease 纳入同一 cursor scope：

```sql
CREATE TABLE recall_lease (
  lease_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  leaf_id TEXT NOT NULL,
  lineage_hash TEXT NOT NULL,
  model_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  remaining_uses INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','consumed','expired','revoked'))
);
```

消费必须在事务中执行 `remaining_uses > 0 AND expires_at_ms > now` 条件更新；Restart 后结果相同；跨 cursor 读取返回 deny。

### Raw Artifact 安全

Live bundle 在公开上传前必须执行：

- key/token/authorization header 扫描；
- 用户路径、邮箱、IP、业务标识脱敏；
- Prompt/Tool Result allowlist；
- 原始私有 trace 与公开可复算 trace 分层；
- secret-scan 报告进入 manifest。
