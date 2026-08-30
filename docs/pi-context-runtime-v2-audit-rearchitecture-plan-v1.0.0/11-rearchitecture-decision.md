# 架构决策：Destructive Vertical Rewrite

## 选择

采用 **Host-agnostic Core + Stateful Runtime + Node Storage + Thin Pi Adapter**，但把应用编排集中在 `packages/runtime`，禁止 app 直接组装 kernel DTO。

## 新目录

```text
apps/pi-context-runtime/        # 唯一 Pi package 与 composition root
packages/contracts/             # wire/domain contracts + JSON Schema
packages/core/                  # 纯函数：reducers/directives/materialization/checkpoint
packages/runtime/               # RuntimeSession、ports、transactions、orchestration
packages/storage-node/          # SQLite/CAS/key/recovery adapters
packages/pi-adapter/            # 仅 Pi event/message conversion
packages/benchmark/             # trace/oracle/arm/scoring/statistics
packages/testkit/               # fake provider/workspace/fault injection
```

## 删除

- 当前 `apps/pi-context-runtime/src/extension.ts`；
- 当前 `packages/pi-adapter` 的自造缩水 event interfaces；
- 当前 hardcoded `SqliteTransaction.putEvidence`；
- 当前 synthetic Gate 生成结果和手工 decision JSON；
- fake packed-install test；
- app 对 sibling `packages/*/src` 的相对导入。

## 保留并移植

- Blob encryption/atomic write；
- reducers 的纯函数实现；
- contracts 中可复用 ID/authority vocabulary；
- section/reduction 的思想；
- paired Pi home runner 的隔离代码。
