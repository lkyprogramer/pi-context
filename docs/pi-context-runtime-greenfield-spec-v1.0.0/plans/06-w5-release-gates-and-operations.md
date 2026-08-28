# W5 — Release Gates and Operations Implementation Plan

> **For agentic workers:** 逐项执行本 Wave 的 Task 文件；本计划只锁定顺序、并行和 Gate，不重定义接口。

**Goal:** 完成 W5 的可运行交付。  
**Architecture:** 依赖主规格和 Task Graph，Task 之间只通过明确 Produces/Consumes 连接。  
**Tech Stack:** TypeScript、pnpm、Vitest、Node/Pi 固定兼容矩阵。  
**Spec:** [`../42-roadmap.md`](../42-roadmap.md)

## Entry Conditions

- 外部依赖 Tasks：`T06, T07, T08, T33, T34, T35, T36, T37, T38, T39, T40, T41, T42, T43, T44` 全部 done。
- `python3 scripts/validate_task_graph.py` 通过。
- 工作树干净，依赖 Evidence commit 可达。

## Recommended Order and Parallelism

```text
T45 <- T33, T39, T40, T41, T42, T43, T44
T46 <- T34, T35, T36, T37, T38, T45
T47 <- T06, T07, T08, T40, T45
T48 <- T44, T45, T46, T47
```

调度器只能并行文件集合不重叠且所有依赖完成的任务。默认保守串行；并行必须由 `taskctl parallel-ready` 证明。

### T45: 执行 Deterministic MVP Release Gate 与 Stop/Continue 决策

**Task file:** [`../tasks/T45-deterministic-mvp-gate.md`](../tasks/T45-deterministic-mvp-gate.md)  
**Dependencies:** `T33, T39, T40, T41, T42, T43, T44`  
**Primary output:** `evaluateDeterministicMvpGate`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T46: 执行 Semantic/Background Beta Gate 与 Ablation 决策

**Task file:** [`../tasks/T46-semantic-beta-gate.md`](../tasks/T46-semantic-beta-gate.md)  
**Dependencies:** `T34, T35, T36, T37, T38, T45`  
**Primary output:** `evaluateSemanticBetaGate`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T47: 实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具

**Task file:** [`../tasks/T47-operations-cli.md`](../tasks/T47-operations-cli.md)  
**Dependencies:** `T06, T07, T08, T40, T45`  
**Primary output:** `createWorkspaceBackup`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。

### T48: 完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证

**Task file:** [`../tasks/T48-release-packaging.md`](../tasks/T48-release-packaging.md)  
**Dependencies:** `T44, T45, T46, T47`  
**Primary output:** `buildReleaseArtifact`  
**Reviewer gate:** 实现、负例、窄测、全门、Evidence、单一 Commit 全部通过。

该任务的逐步代码、文件边界和命令只在 Task 文件维护；本计划不复制第二套合同。


## Exit Gate

- 本 Wave 每个 Task Evidence 均有效且 commit 可达。
- `pnpm check:all` 通过。
- 对应 Wave Gate/kill criteria 已写入 `reports/gates/` 或 blocker。
