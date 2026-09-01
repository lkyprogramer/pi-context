# Storage、Recovery 与 Security 审计

## 强项

- Per-workspace SQLite、完整 Cursor 字段和跨 scope 拒绝；
- Encrypted content-addressed blob store；
- 同内容并发写与 key rotation tests；
- Saga prepared/host-visible/recovery 状态；
- Evidence exact read + FTS；
- Authority、memory poisoning、secret leak、cursor/recovery fuzz tests；
- Pointer Verifier 可读取 CAS 并校验 scope。

这些改动足以证明 Storage 子系统已从 Stub 进化到真实实现。

## Recovery 的关键缺口

### 1. Compaction Stage/Ack 不持久

默认扩展只维护一个 `let staged`。进程在 `session_before_compact` 返回后、`session_compact` 之前退出，候选关联关系丢失。产品 `RuntimeSessionPorts.compaction.acknowledge` 当前是空函数。

### 2. 两条事实链尚未闭环

应有：

```text
Pi JSONL compaction entry
↔ staged operationId/outputHash/firstKept
↔ Runtime Store generation/heads
```

当前只对内存对象做 outputHash 比较，没有 durable correlation receipt。

### 3. Background 状态不是安全产品路径

Candidate store 是 in-memory Map，Snapshot 使用 fixture hash；`markPrepared` 只写一个背景 Candidate 记录，不代表真实生成/验证/提交。

## 安全结论

安全组件测试质量较高，但“系统安全”不能由组件数量推导。发布前必须把 CAS exact recovery、cross-scope denial、tool pair、secret variants、outcome attestation 绑定到同一真实 Live Arm 和同一 Run Bundle。
