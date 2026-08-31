# 产品纵向路径审计

## User/Tool Ingress

评价：**大幅改善，接近可用**。

已具备 raw CAS、reducer、Evidence/FTS 和工具解析。但应补：

- host message ack 与 Saga 状态的完整生命周期；
- cursor-scoped pointer catalog；
- session shutdown 只关闭对应 session/workspace；
- restart catch-up 与 orphan reconciliation；
- Secret scrub 在所有可见/索引/日志出口一致执行。

## Context

评价：**未达到 Store-backed Runtime**。

当前把全部 user messages 当 directives；这不是 active directive ledger。它会：

- 重复最新用户消息；
- 让 superseded directive 继续可见；
- 把普通问题/闲聊当 hard directive；
- 不包含 Continuity、Recall、Task Front；
- 每次请求丢失上一 request 的 CacheReceipt。

## Compaction

评价：**Renderer/Service 成立，事实源不成立**。

应从同一 snapshot transaction 读取 active directive、temporal values、continuity、unresolved errors、side effects、evidence pointer。当前从 `messagesToSummarize` 临时重建，不能跨 recursive compaction/restart 保证一致。

## Lifecycle/Background

评价：**仍是 Alpha stub**。

不应进入 deterministic MVP release claim；先保持 default-off 或完全不注册产品行为，直到恢复与 fencing 的真实 Gate 通过。
