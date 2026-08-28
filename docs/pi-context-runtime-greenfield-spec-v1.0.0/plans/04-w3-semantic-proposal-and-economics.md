# W3 — Semantic Proposal and Economics Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W3 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`T08, T15, T20, T21, T23, T24, T26, T30, T31, T33` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T34 <- T08, T23, T30, T33
T35 <- T20, T23, T34
T36 <- T15, T20, T21, T23, T35
T37 <- T34, T36, T08
T38 <- T24, T26, T31, T37
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T34: 实现 `agent_settled` 后的可取消 Background Candidate Worker

**Task file:** [`../tasks/T34-background-candidates.md`](../tasks/T34-background-candidates.md)  
**Dependencies:** `T08, T23, T30, T33`  
**Primary output:** `CandidateWorker`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T35: 实现 Semantic Proposal Schema 与受限生成 Adapter

**Task file:** [`../tasks/T35-semantic-proposal.md`](../tasks/T35-semantic-proposal.md)  
**Dependencies:** `T20, T23, T34`  
**Primary output:** `generateSemanticProposal`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T36: 实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor

**Task file:** [`../tasks/T36-verifier.md`](../tasks/T36-verifier.md)  
**Dependencies:** `T15, T20, T21, T23, T35`  
**Primary output:** `verifySemanticProposal`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T37: 实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard

**Task file:** [`../tasks/T37-generation-fencing.md`](../tasks/T37-generation-fencing.md)  
**Dependencies:** `T34, T36, T08`  
**Primary output:** `publishVerifiedGeneration`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T38: 实现脱敏 Telemetry、Cache/Economics 与 Realized Net Value Controller

**Task file:** [`../tasks/T38-telemetry-economics.md`](../tasks/T38-telemetry-economics.md)  
**Dependencies:** `T24, T26, T31, T37`  
**Primary output:** `calculateRealizedNetValue`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
