# W2 — State Runtime and Pi Convergence Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W2 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`T02, T03, T04, T05, T06, T08, T10, T15, T16, T19` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T20 <- T15, T06
T21 <- T20
T22 <- T15, T20, T21, T05
T23 <- T10, T20, T21
T24 <- T03, T05
T25 <- T02, T15, T23, T24
T26 <- T19, T23, T24, T25
T27 <- T04, T05, T26
T28 <- T19, T23, T26
T29 <- T10, T20, T23, T24
T30 <- T29, T15, T16
T31 <- T04, T05, T30
T32 <- T24, T27, T31
T33 <- T08, T27, T31, T32
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T20: 实现 Bitemporal Claim Ledger 与 Support Closure

**Task file:** [`../tasks/T20-claim-ledger.md`](../tasks/T20-claim-ledger.md)  
**Dependencies:** `T15, T06`  
**Primary output:** `ClaimLedger`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T21: 实现 Claim 冲突、Supersession、Retraction 与 Audit Slice

**Task file:** [`../tasks/T21-claim-conflict-supersession.md`](../tasks/T21-claim-conflict-supersession.md)  
**Dependencies:** `T20`  
**Primary output:** `applyClaimTransition`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T22: 实现 Outcome Attestation 与 Side-effecting Tool Action Gate

**Task file:** [`../tasks/T22-outcome-attestation-action-gate.md`](../tasks/T22-outcome-attestation-action-gate.md)  
**Dependencies:** `T15, T20, T21, T05`  
**Primary output:** `authorizeToolCall`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T23: 实现 Task Fronts、External Side Effects 与 Next Safe Action Ledger

**Task file:** [`../tasks/T23-continuity-ledger.md`](../tasks/T23-continuity-ledger.md)  
**Dependencies:** `T10, T20, T21`  
**Primary output:** `reduceContinuityRevision`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T24: 实现有效输入预算、Provider Usage 校准与预测增长

**Task file:** [`../tasks/T24-token-accounting.md`](../tasks/T24-token-accounting.md)  
**Dependencies:** `T03, T05`  
**Primary output:** `computeEffectiveInputBudget`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T25: 实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity

**Task file:** [`../tasks/T25-active-turn-suffix.md`](../tasks/T25-active-turn-suffix.md)  
**Dependencies:** `T02, T15, T23, T24`  
**Primary output:** `buildExactActiveSuffix`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T26: 实现四区 Cache-aware Request Materializer 与 Reduction Ladder

**Task file:** [`../tasks/T26-materializer.md`](../tasks/T26-materializer.md)  
**Dependencies:** `T19, T23, T24, T25`  
**Primary output:** `ContextMaterializer`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T27: 接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort

**Task file:** [`../tasks/T27-context-hook-integration.md`](../tasks/T27-context-hook-integration.md)  
**Dependencies:** `T04, T05, T26`  
**Primary output:** `registerContextHook`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T28: 实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap

**Task file:** [`../tasks/T28-retrieval-leases.md`](../tasks/T28-retrieval-leases.md)  
**Dependencies:** `T19, T23, T26`  
**Primary output:** `LeasePolicy`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T29: 实现 Pi Host Checkpoint Schema 与 Cache-stable Renderer

**Task file:** [`../tasks/T29-host-checkpoint-renderer.md`](../tasks/T29-host-checkpoint-renderer.md)  
**Dependencies:** `T10, T20, T23, T24`  
**Primary output:** `renderHostCheckpoint`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T30: 构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate

**Task file:** [`../tasks/T30-deterministic-host-checkpoint.md`](../tasks/T30-deterministic-host-checkpoint.md)  
**Dependencies:** `T29, T15, T16`  
**Primary output:** `buildDeterministicCheckpointCandidate`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T31: 接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment

**Task file:** [`../tasks/T31-compaction-takeover.md`](../tasks/T31-compaction-takeover.md)  
**Dependencies:** `T04, T05, T30`  
**Primary output:** `registerCompactionHooks`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T32: 实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure

**Task file:** [`../tasks/T32-host-convergence-controller.md`](../tasks/T32-host-convergence-controller.md)  
**Dependencies:** `T24, T27, T31`  
**Primary output:** `decideHostConvergence`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T33: 实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery

**Task file:** [`../tasks/T33-session-lifecycle.md`](../tasks/T33-session-lifecycle.md)  
**Dependencies:** `T08, T27, T31, T32`  
**Primary output:** `registerSessionLifecycle`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
