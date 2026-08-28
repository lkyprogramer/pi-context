# Pi `tool_result` Hook 集成

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

规定原文捕获时序、Pi afterToolCall 语义、结果修改、Details 保留和故障策略。

## 2. 已冻结决策

- Handler 返回 content/details/isError/usage 的最小必要修改。
- PCR 内部 receipt 不塞入 tool-specific details。
- raw CAS 发生在 compact view 返回前。
- 同一 toolCallId 重放幂等。

## 3. Handler Skeleton

```ts
pi.on("tool_result", async (event, ctx) => {
  const signal = ctx.signal ?? new AbortController().signal;
  try {
    const input = adapter.toObservationInput(event, ctx);
    const projected = await runtime.projectObservation(input, signal);
    return {
      content: adapter.toPiContent(projected.visibleContent),
      isError: projected.isError,
      usage: event.usage,
      details: event.details,
    };
  } catch (error) {
    return adapter.recoverObservation(error, event, ctx);
  }
});
```

## 4. Handler Ordering

Pi 不保证 PCR 是未知第三方 `tool_result` Handler 中最早的。部署要求只保留一个不可逆 Tool Result rewriter；Known Conflict 检查发现冲突时 strict 模式不启动。文档和 telemetry 必须把 `rawCapturePosition=extension-pipeline` 写清，不能宣称捕获了 Provider/Tool 原始字节之前的内容。

## 5. Synthetic/Immediate Errors

未知 Tool、参数校验失败、被 `tool_call` 阻断、abort 和 truncated tool call 都会生成 ToolResult。它们同样进入 `tool_result`，Evidence kind 标 `synthetic-tool-outcome`，不得伪造真实工具执行。

## 6. 不变量

1. 被阻断 Tool Call 的 error result authority 为 agent-derived/propose。
2. Tool result image normalization后 hash 与 Pi 可见内容分别记录。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `15-observation-ingress.md`
- `tasks/T11-tool-result-raw-capture.md`
