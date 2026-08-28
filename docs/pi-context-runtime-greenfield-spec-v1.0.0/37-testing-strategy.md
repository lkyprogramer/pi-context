# 测试策略

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义分层 TDD、property/mutation/fault/golden/compat/e2e，以及每个任务的独立 reviewer gate。

## 2. 已冻结决策

- 每个 Task 必须有 RED→GREEN 证据。
- Canonical encoder/hash 有 golden bytes。
- 状态机、authority、supersession 使用 property/mutation test。
- Pi Hook 使用 fake host + pinned real package contract tests。
- Golden trace 不允许自动刷新。

## 3. 测试层

| 层 | 目标 |
|---|---|
| unit | pure domain/reducer/materializer |
| property | idempotence、monotonicity、non-escalation、budget |
| integration | storage worker/CAS/Saga |
| contract | Pi public hooks and event ordering |
| e2e | packed package in temporary Pi home/workspace |
| fault | kill at every Saga/Compaction phase |
| security | injection/secret/egress/cursor/DoS |
| performance | clone/materialization/FTS/fsync/GC |
| benchmark | task success, recall, cache economics |

## 4. Required Mutation Tests

删除以下 guard 必须导致测试失败：source non-escalation、active directive pin、tool pair boundary、outcome attestation、workspace filter、branch ancestry、stable head CAS、lease cap、secret scrub、host checkpoint shrink。

## 5. Determinism

所有 fixture 有 seed、Pi version、Node/OS、config fingerprint、schema/reducer revisions。时间由 injected clock；UUID/nonce 测试使用 deterministic provider。

## 6. 不变量

1. 测试通过不能替代 spec coverage checklist。
2. 不接受只验证 mock 而不跑 packed Pi E2E。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `tasks/EXECUTION-PROTOCOL.md`
- `checklists/testing.md`
