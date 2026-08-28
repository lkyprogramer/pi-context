# W4 — Productization, Evaluation, Compatibility Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W4 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`T04, T05, T06, T07, T10, T15, T16, T18, T19, T22, T26, T27, T28, T31, T36, T38` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T39 <- T16, T18, T19, T22, T28
T40 <- T04, T05, T27, T31, T39
T41 <- T06, T07, T18, T26, T31
T42 <- T27, T31, T38, T41
T43 <- T07, T10, T15, T22, T31, T36
T44 <- T05, T27, T31, T40
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T39: 实现 Recall/Search/Status/Pin 工具与运维命令

**Task file:** [`../tasks/T39-runtime-tools-commands.md`](../tasks/T39-runtime-tools-commands.md)  
**Dependencies:** `T16, T18, T19, T22, T28`  
**Primary output:** `registerRuntimeTools`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T40: 实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理

**Task file:** [`../tasks/T40-package-install-conflicts.md`](../tasks/T40-package-install-conflicts.md)  
**Dependencies:** `T04, T05, T27, T31, T39`  
**Primary output:** `runRuntimeDoctor`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T41: 运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO

**Task file:** [`../tasks/T41-performance-spikes.md`](../tasks/T41-performance-spikes.md)  
**Dependencies:** `T06, T07, T18, T26, T31`  
**Primary output:** `runPerformanceSpikes`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T42: 实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution

**Task file:** [`../tasks/T42-benchmark-harness.md`](../tasks/T42-benchmark-harness.md)  
**Dependencies:** `T27, T31, T38, T41`  
**Primary output:** `runBenchmarkSuite`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T43: 实现 Memory Poisoning、Secret、Authority、Cursor 与 Recovery Fuzz/Mutation Suite

**Task file:** [`../tasks/T43-security-fuzz.md`](../tasks/T43-security-fuzz.md)  
**Dependencies:** `T07, T10, T15, T22, T31, T36`  
**Primary output:** `runSecuritySuite`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T44: 实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics

**Task file:** [`../tasks/T44-pi-compatibility-ci.md`](../tasks/T44-pi-compatibility-ci.md)  
**Dependencies:** `T05, T27, T31, T40`  
**Primary output:** `verifyPiCompatibility`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
