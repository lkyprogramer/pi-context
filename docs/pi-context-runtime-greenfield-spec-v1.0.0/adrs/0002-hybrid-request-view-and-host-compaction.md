# ADR-0002: 请求时物化 + 周期性 Pi 原生 Compaction

**Status:** accepted  
**Date:** 2026-08-26

## Context

本 ADR 属于 Pi Context Runtime Greenfield 规格。决策必须与 `06-host-agnostic-contracts.md`、Pi 公开 API 和 AI Agent 任务保持一致。

## Decision

请求时物化 + 周期性 Pi 原生 Compaction。

## Positive Consequences

- Context View 有界且动态
- 宿主 active message/clone 成本也能收敛

## Negative Consequences

- 必须同时维护 request view 和 host checkpoint 语义

## Rejected Alternatives

- 维护 Pi Fork 或修改 `agent-loop.ts`；
- 依赖未导出的 Pi 私有实现；
- 在文档中模糊保留两套相互冲突的接口。

## Verification

- 对应 Task 必须包含 RED/GREEN、negative/fault test 和 packed Pi contract test；
- 任何变更本 ADR 的实现必须新增 superseding ADR，不能覆盖历史。
