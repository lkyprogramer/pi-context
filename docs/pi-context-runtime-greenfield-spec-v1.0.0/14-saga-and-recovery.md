# 跨 Pi JSONL 与 PCR Store 的 Saga 与恢复

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义无法跨存储 ACID 时的状态机、幂等 ID、crash matrix、重放和不一致修复。

## 2. 已冻结决策

- 不声称 Pi JSONL 与 SQLite/CAS 原子提交。
- operation ID 绑定 session/leaf/toolCall or compaction/preimage hash。
- 状态机：prepared → host-visible → acknowledged → committed/recovered/stale。
- 所有步骤幂等；恢复不产生第二份逻辑 Evidence。

## 3. Operation State

```ts
export type SagaState =
  | "prepared"
  | "host-visible"
  | "acknowledged"
  | "committed"
  | "recovered"
  | "stale"
  | "quarantined";
```

## 4. Observation Saga

1. `tool_result` 生成 operationId；
2. raw blob 写入并记录 prepared；
3. reducer/evidence transaction；
4. compact result 返回 Pi；
5. `message_end`/`turn_end` 根据 toolCallId 与 content hash 标 host-visible/acknowledged；
6. transaction committed；
7. `session_start` 对未终态 operation 对账。

## 5. Compaction Saga

1. generation prepared；
2. `session_before_compact` 返回 checkpoint/details；
3. Pi 写 CompactionEntry；
4. `session_compact` 携 entry ID；
5. generation committed；
6. 缺 ack 时按 branch entry 扫描补写。

## 6. Crash Matrix

| 位置 | 可观察状态 | 恢复 |
|---|---|---|
| raw blob 前 | 无 | 重试 |
| blob 后、Pi 前 | orphan prepared | replay 认领或 grace GC |
| Pi 后、ack 前 | host exists | 按 toolCallId/hash 补 ack |
| checkpoint entry 后、generation 前 | host ahead | details 恢复 head |
| candidate 后、compaction cancel | stale | 标 stale，不发布 |

## 7. 不变量

1. 恢复只前进终态，不回写或篡改 Pi 已持久消息。
2. 重复 session_start 不改变 committed logical state。

## 8. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 9. 关联资料

- `diagrams/10-failure-recovery.mmd`
- `tasks/T08-saga-recovery.md`
