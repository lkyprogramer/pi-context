# W0 — Foundation and Host Contract Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W0 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`none` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T01 <- root
T02 <- T01
T03 <- T02
T04 <- T01, T02
T05 <- T01, T04
T06 <- T02, T03
T07 <- T02, T03
T08 <- T05, T06, T07
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T01: 创建 Monorepo、包边界与基础 CI

**Task file:** [`../tasks/T01-workspace-scaffold.md`](../tasks/T01-workspace-scaffold.md)  
**Dependencies:** `none`  
**Primary output:** `assertWorkspaceLayout`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T02: 实现唯一 Canonical Type、ID 与错误词汇

**Task file:** [`../tasks/T02-canonical-contracts.md`](../tasks/T02-canonical-contracts.md)  
**Dependencies:** `T01`  
**Primary output:** `SourceClass`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T03: 实现确定性编码、域隔离哈希、时钟与 ID Provider

**Task file:** [`../tasks/T03-canonical-encoding-hashes.md`](../tasks/T03-canonical-encoding-hashes.md)  
**Dependencies:** `T02`  
**Primary output:** `domainHash`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T04: 实现单一 Pi Extension Orchestrator 与进程级 Owner Claim

**Task file:** [`../tasks/T04-single-extension-orchestrator.md`](../tasks/T04-single-extension-orchestrator.md)  
**Dependencies:** `T01, T02`  
**Primary output:** `claimPiContextOwner`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T05: 实现 Pi Public API Capability Probe 与契约测试宿主

**Task file:** [`../tasks/T05-pi-contract-harness.md`](../tasks/T05-pi-contract-harness.md)  
**Dependencies:** `T01, T04`  
**Primary output:** `probePiCapabilities`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T06: 实现单写 Worker、SQLite Schema 与事务 RPC

**Task file:** [`../tasks/T06-sqlite-store.md`](../tasks/T06-sqlite-store.md)  
**Dependencies:** `T02, T03`  
**Primary output:** `SqliteStore`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T07: 实现加密 Content-addressed Blob Store 与 Key Provider

**Task file:** [`../tasks/T07-encrypted-blob-cas.md`](../tasks/T07-encrypted-blob-cas.md)  
**Dependencies:** `T02, T03`  
**Primary output:** `EncryptedBlobStore`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T08: 实现跨 Pi JSONL 与 Runtime Store 的可恢复 Saga

**Task file:** [`../tasks/T08-saga-recovery.md`](../tasks/T08-saga-recovery.md)  
**Dependencies:** `T05, T06, T07`  
**Primary output:** `SagaCoordinator`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
