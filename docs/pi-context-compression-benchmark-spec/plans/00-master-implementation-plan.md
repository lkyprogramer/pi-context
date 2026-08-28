# Pi Context Compression Benchmark Master Implementation Plan

> **For agentic workers:** 必须按 `tasks/EXECUTION-PROTOCOL.md` 一次执行一个 Bxx Task，并保存 RED/GREEN/Full Gate Evidence。

**Goal:** 构建一个不依赖单一 LLM Judge、可直接证明 W1 增量价值并在 W2 正面对比 Pi Native/PCR Compactor 的可复现 Benchmark 系统。  
**Architecture:** Canonical RawTrace/BoundarySnapshot/Oracle 为事实源；Arm Runner 生成不可变 Artifact；Static、Reader、Closed-loop 三层评分；Paired Statistics 与词典序 Gate 生成机器决策。  
**Tech Stack:** Node 22+、TypeScript 5.9、Vitest、Pi Public Extension API、JSON Schema、Python artifact validators。  
**Spec:** `04-experimental-arms-and-factorial-design.md`、`16-w1-early-net-value-gate.md`、`17-w2-compactor-head-to-head-gate.md`

## Global Constraints

- 不修改 Pi 源码、不导入 Pi 私有 `src/` 路径。
- W1 不得实现或宣称独立 Compactor。
- 同一比较必须共享 RawTrace、Boundary、Budget、Model、Seed 和 Workspace Snapshot。
- LLM Judge 不得成为唯一 Gate。
- Safety/Integrity/Quality 优先于 Token/Cost。
- Raw Run Artifact、Oracle 和 Golden 不得原位更新。
- 所有 Gate 由 machine-readable JSON 决定。

## Tasks

| ID | Deliverable | Depends On |
|---|---|---|
| B01 | Benchmark monorepo/contracts | — |
| B02 | RawTrace capture and replay | B01 |
| B03 | Boundary snapshot/restore | B01, B02 |
| B04 | Oracle annotation/validator | B01, B02 |
| B05 | Pi Native arm runner | B02, B03 |
| B06 | W1 ingress arms A1/A2 | B05 |
| B07 | W2 compactor arms B0/B1/B2 | B05, B06 |
| B08 | Static artifact scorer | B04, B05 |
| B09 | Blob/recoverability suite | B04, B06 |
| B10 | Recall needed/not-needed scorer | B04, B06 |
| B11 | Reader-isolated runner | B04, B08 |
| B12 | Paired closed-loop runner | B03, B05, B06 |
| B13 | Token/cache/cost/latency instrumentation | B05, B06, B07 |
| B14 | Blind LLM Judge | B04, B08 |
| B15 | Paired statistics/non-inferiority | B08, B11, B12, B13 |
| B16 | Corpus adapters and sealed sets | B02, B03, B04 |
| B17 | Reports and W1/W2 Gate engine | B09, B10, B15, B16 |
| B18 | PCR roadmap integration/release artifact | B17 |

## Wave Gates

- Foundation：B01–B05 可稳定复现 Pi Native。
- W1：B06、B08–B10、B13、B15–B17 产生 Early Gate。
- W2：B07、B11–B17 产生 Compactor Head-to-head Gate。
- Release：B18 验证 clean install、manifest 和文档。
