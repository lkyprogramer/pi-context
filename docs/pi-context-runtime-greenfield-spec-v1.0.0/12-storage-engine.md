# SQLite Storage Engine 与单写 Worker

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 node:sqlite 使用方式、Schema、单写协议、迁移、FTS 能力探测与恢复边界。

## 2. 已冻结决策

- Node floor 为 `^22.23.2 || ^24.18.1 || >=26.5.1`。
- 只在 dedicated worker 中使用 `DatabaseSync`。
- 禁止 `DatabaseSync#createTagStore()` 和 SQLTagStore。
- Canonical write 使用 WAL + transaction + explicit checkpoint。
- FTS5 启动时探测；balanced/quality profile 缺失时 not-ready，minimal 可 exact-only。

## 3. 数据库职责

Canonical tables：operation、observation、evidence、directive、claim、claim_support、continuity_revision、generation、lease、security_decision。  
Serving tables：FTS documents、rank features、materialized section cache、telemetry aggregates、maintenance cursors。

## 4. Worker RPC

```ts
interface StorageRequestMap {
  migrate: { input: MigrationRequest; output: MigrationReport };
  executeCanonical: { input: CanonicalTransaction; output: CommitReceipt };
  query: { input: TypedQuery; output: QueryResult };
  checkpoint: { input: CheckpointRequest; output: CheckpointReceipt };
  close: { input: {}; output: {} };
}
```

主线程不能持有 SQLite Connection。每个 request 有 monotonic request ID、AbortSignal bridge、timeout 和 structured error。

## 5. Durability

- `journal_mode=WAL`；
- canonical commit profile 使用 `synchronous=FULL`；
- serving rebuild 可使用 batch；
- migration 在独占 startup phase；
- 未知 schema version fail closed；
- startup 完整性检查失败进入 read-only recovery mode。

## 6. 不变量

1. Canonical table 只能经 storage worker transaction 修改。
2. Serving index 可删除重建，不能作为 source authority。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `reference/schema.sql`
- `tasks/T06-sqlite-store.md`
