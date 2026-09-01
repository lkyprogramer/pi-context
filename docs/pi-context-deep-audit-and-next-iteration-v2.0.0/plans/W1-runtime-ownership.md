# W1 — Runtime Ownership 与 Durability

所有 Hook 经 RuntimeSession，原子 Snapshot，Durable Compaction Ack，多 Session 安全。

## Task DAG

- `B08` 所有 User/Tool Ingress 必须调用 RuntimeSession — depends: B03
- `B09` 按 Session/Branch 保存 Lifecycle Cursor — depends: B08
- `B10` 实现 Session-scoped Shutdown 与资源引用计数 — depends: B09
- `B11` Context 与 Compaction 共用 Atomic RuntimeSnapshot — depends: B08
- `B12` 持久化 Compaction Stage/Ack/Failure Saga — depends: B11
- `B13` 把 Hard Gate Verifier 接入产品 Compaction — depends: B11, B12
- `B14` 默认关闭 Background，删除 Fixture/Unbound Production Path — depends: B09
- `B15` 产品级多 Workspace/Session 并发与故障 Gate — depends: B08, B09, B10, B11, B12

## Exit Gate

- 所有 Task Evidence v2 验证通过；
- Findings 关闭有当前 HEAD 证据；
- Full Gate 干净重跑；
- 不以 synthetic component 代替 product/live acceptance。
