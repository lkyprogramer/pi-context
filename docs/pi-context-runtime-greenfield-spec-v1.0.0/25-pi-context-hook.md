# Pi `context` Hook 集成

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

规定 AgentMessage ↔ HostMessage 转换、Handler 顶层、cursor、materializer、fallback 和最终返回。

## 2. 已冻结决策

- Handler 在单一 Extension factory 中注册一次。
- 使用 `ctx.model` 和 current ContextUsage，但不修改 Pi canonical messages。
- 转换层保留 content/timestamp/tool IDs。
- 所有异常在 Handler 内部分类；Pi Runner fail-open 不作为系统策略。

## 3. Handler Skeleton

```ts
pi.on("context", async (event, ctx) => {
  const signal = ctx.signal ?? new AbortController().signal;
  try {
    const cursor = await adapter.cursorFrom(ctx.sessionManager, ctx.model, ctx.thinkingLevel);
    const input = await adapter.toMaterializationInput(event.messages, cursor, ctx);
    const view = await runtime.materialize(input, signal);
    await adapter.recordViewReceipt(view, ctx);
    return { messages: adapter.toPiMessages(view.messages) };
  } catch (error) {
    return adapter.recoverContext(error, event.messages, ctx);
  }
});
```

## 4. Fallback Ladder

1. committed deterministic generation + exact active suffix；
2. directives + recent safe tail；
3. Pi canonical messages with large tool results pointerized；
4. hard safety failure：`ctx.abort()` + safe diagnostic message。

## 5. Performance

Pi 已在 Handler 前 clone 全历史。Handler 必须 O(active Pi context + bounded catalog query)，并由 periodic Compaction 约束 active message count。对 clone P95 超门时主动触发 host checkpoint。

## 6. 不变量

1. 不得 mutate `event.messages`。
2. 不得在 Context Hook 启动无界后台任务。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `tasks/T27-context-hook-integration.md`
- `39-performance-slo.md`
