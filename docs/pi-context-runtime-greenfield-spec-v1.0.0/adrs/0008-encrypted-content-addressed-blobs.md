# ADR-0008: 加密 Content-addressed Blob Store

**Status:** accepted  
**Date:** 2026-08-26

## Context

本 ADR 属于 Pi Context Runtime Greenfield 规格。决策必须与 `06-host-agnostic-contracts.md`、Pi 公开 API 和 AI Agent 任务保持一致。

## Decision

加密 Content-addressed Blob Store。

## Positive Consequences

- 可验证、去重、重建 pointer

## Negative Consequences

- 密钥生命周期成为运维责任

## Rejected Alternatives

- 维护 Pi Fork 或修改 `agent-loop.ts`；
- 依赖未导出的 Pi 私有实现；
- 在文档中模糊保留两套相互冲突的接口。

## Verification

- 对应 Task 必须包含 RED/GREEN、negative/fault test 和 packed Pi contract test；
- 任何变更本 ADR 的实现必须新增 superseding ADR，不能覆盖历史。
