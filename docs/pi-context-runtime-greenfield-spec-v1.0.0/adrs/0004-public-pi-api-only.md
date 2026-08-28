# ADR-0004: 只使用 Pi 公共 Export 和 Extension API

**Status:** accepted  
**Date:** 2026-08-26

## Context

本 ADR 属于 Pi Context Runtime Greenfield 规格。决策必须与 `06-host-agnostic-contracts.md`、Pi 公开 API 和 AI Agent 任务保持一致。

## Decision

只使用 Pi 公共 Export 和 Extension API。

## Positive Consequences

- 无需 Fork/merge
- 可自动兼容测试

## Negative Consequences

- 公开 API 仍是 0.x，需要窄支持窗口

## Rejected Alternatives

- 维护 Pi Fork 或修改 `agent-loop.ts`；
- 依赖未导出的 Pi 私有实现；
- 在文档中模糊保留两套相互冲突的接口。

## Verification

- 对应 Task 必须包含 RED/GREEN、negative/fault test 和 packed Pi contract test；
- 任何变更本 ADR 的实现必须新增 superseding ADR，不能覆盖历史。
