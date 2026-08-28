# W1 — Deterministic Value Slice Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W1 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`T02, T05, T06, T07, T08` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T09 <- T02, T05, T06, T08
T10 <- T09
T11 <- T05, T07, T08
T12 <- T02, T11
T13 <- T12
T14 <- T12
T15 <- T10, T11, T12, T13, T14, T06
T16 <- T15, T07
T17 <- T15, T06
T18 <- T17, T06
T19 <- T10, T16, T18
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T09: 捕获原始 Input Receipt 并关联 Pi 展开后的 User Message

**Task file:** [`../tasks/T09-raw-input-receipt.md`](../tasks/T09-raw-input-receipt.md)  
**Dependencies:** `T02, T05, T06, T08`  
**Primary output:** `InputCorrelator`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T10: 实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量

**Task file:** [`../tasks/T10-user-directive-capture.md`](../tasks/T10-user-directive-capture.md)  
**Dependencies:** `T09`  
**Primary output:** `captureUserDirectives`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T11: 在 Pi `tool_result` 写入前完成原文捕获、CAS 与 Prepared Receipt

**Task file:** [`../tasks/T11-tool-result-raw-capture.md`](../tasks/T11-tool-result-raw-capture.md)  
**Dependencies:** `T05, T07, T08`  
**Primary output:** `captureObservation`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T12: 实现确定性 Reducer Registry、Revision 路由与资源限制

**Task file:** [`../tasks/T12-reducer-registry.md`](../tasks/T12-reducer-registry.md)  
**Dependencies:** `T02, T11`  
**Primary output:** `ReducerRegistry`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T13: 实现 Bash/构建/测试日志 Reducers

**Task file:** [`../tasks/T13-shell-build-test-reducers.md`](../tasks/T13-shell-build-test-reducers.md)  
**Dependencies:** `T12`  
**Primary output:** `reduceTestLog`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T14: 实现 read/grep/find/ls/edit/write 的结构化 Reducers

**Task file:** [`../tasks/T14-builtin-tool-reducers.md`](../tasks/T14-builtin-tool-reducers.md)  
**Dependencies:** `T12`  
**Primary output:** `reduceSearchResult`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T15: 实现 EvidenceUnit Admission、Provenance 与 Observation Projection

**Task file:** [`../tasks/T15-evidence-units.md`](../tasks/T15-evidence-units.md)  
**Dependencies:** `T10, T11, T12, T13, T14, T06`  
**Primary output:** `admitEvidence`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T16: 实现 Evidence/Blob/Range 的精确读取与 Scope Enforcement

**Task file:** [`../tasks/T16-exact-evidence-read.md`](../tasks/T16-exact-evidence-read.md)  
**Dependencies:** `T15, T07`  
**Primary output:** `readEvidenceById`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T17: 实现 Literal/Path/Error/Command 倒排索引与时间过滤

**Task file:** [`../tasks/T17-literal-search-index.md`](../tasks/T17-literal-search-index.md)  
**Dependencies:** `T15, T06`  
**Primary output:** `LiteralIndex`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T18: 实现 Workspace-scoped FTS5 Catalog、Rebuild 与 Fallback

**Task file:** [`../tasks/T18-fts-catalog.md`](../tasks/T18-fts-catalog.md)  
**Dependencies:** `T17, T06`  
**Primary output:** `FtsCatalog`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T19: 实现每个顶层 User Turn 的主动 Recall Query 与有界 Page

**Task file:** [`../tasks/T19-proactive-recall.md`](../tasks/T19-proactive-recall.md)  
**Dependencies:** `T10, T16, T18`  
**Primary output:** `buildProactiveRecallPage`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
