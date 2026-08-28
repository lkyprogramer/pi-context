# Pi 公开 API 映射

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

逐一说明 Pi Hook、上下文数据、返回语义、异常行为和 PCR 使用规则。

## 2. 已冻结决策

- `context` 是请求物化主入口。
- `tool_result` 是 Observation 主入口。
- `tool_call` 是 Side-effect Action Gate。
- `session_before_compact` 是 Host Checkpoint Provider。
- `session_compact` 是 Host Commit Acknowledgment。
- `appendEntry` 只写小型 Receipt/Head，不写 raw payload。

## 3. Hook 表

| Hook | 输入 | PCR 返回/动作 | 错误策略 |
|---|---|---|---|
| `input` | raw text/images/source | 保存 pre-expansion input correlation | 内部 fallback；不改变文本 |
| `before_agent_start` | expanded prompt/system | proactive recall preparation | 不注入时保持沉默 |
| `context` | cloned AgentMessage[] | 替换 request-local messages | typed fallback；hard failure `ctx.abort()` |
| `tool_call` | toolName/input/callId | block/allow/terminate | fail closed on action authority |
| `tool_result` | content/details/isError | raw capture + compact content | raw capture failure按profile处理 |
| `message_end` | finalized message | correlation/usage/host receipt | 幂等记录 |
| `turn_end` | assistant + tool results | Saga acknowledgment | recovery on next start |
| `agent_settled` | none | background/maintenance/host compact decision | bounded, cancellable |
| `session_before_compact` | preparation/branch/reason | custom deterministic CompactionResult | overflow never waits semantic |
| `session_compact` | saved entry | commit generation/head | idempotent |
| `session_tree` | old/new leaf | switch active generation by ancestry | no external-world rollback |
| `session_shutdown` | reason | flush/close worker | bounded shutdown |

## 4. Handler Error Reality

Pi Runner 会记录部分扩展异常并继续。因此 PCR Handler 不能通过 `throw` 表示“请求必然被阻断”。每个 Handler 顶层必须：

```ts
try {
  return await adapter.handle(event, ctx);
} catch (error) {
  return adapter.recoverAtBoundary(event, ctx, normalizeError(error));
}
```

Hard Safety Failure 必须显式调用 `ctx.abort()`，并返回 role-valid emergency view 或 block decision。

## 5. 不变量

1. 不依赖 Handler priority。
2. 不使用 `before_provider_request` 作为正确性主路径；它只做支持 Provider 的最终诊断。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `pi-adapter/01-hook-contracts.md`
- `reference/pi-extension-skeleton.ts`
