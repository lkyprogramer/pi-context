# Authenticated User Directive Lane

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

保证用户原话在 request-time working-set 模式下不会因语义漏检而永久缺席。

## 2. 已冻结决策

- 同时记录 raw pre-expansion input 与 expanded prompt。
- 只有 channel policy 认可的 raw input 可产生 authenticated directive。
- Directive 引用 exact quote、byte range、source hash。
- Semantic model 无权创建、改写或退休 authenticated directive。
- 只能由后续 authenticated input supersede/retract。

## 3. Correlation

`input` event 创建 `PendingInputReceipt`；随后真实 user `message_end` 使用 timestamp、text hash 和 pending queue 做匹配。技能/模板展开后的新增文本标为 agent-derived，不能成为用户授权。

## 4. Directive Schema

```ts
interface UserDirective {
  directiveId: string;
  sessionId: string;
  sourceInputId: string;
  sourceContentHash: string;
  quote: string;
  byteRange: { start: number; end: number };
  kind: "goal" | "constraint" | "permission" | "prohibition" |
        "format" | "correction" | "preference" | "acceptance-criterion";
  polarity: "must" | "must-not" | "may" | "is" | "is-not" | "unknown";
  status: "active" | "superseded" | "resolved" | "retracted" | "contested";
  scope: DirectiveScope;
}
```

## 5. Budget Semantics

Active hard directive 永远先于 directory/episode/recall 分配预算。如果全部 active directive 无法装入 `I_eff`，返回 `DIRECTIVE_BUDGET_EXCEEDED` 并 fail closed；不得静默 drop。

## 6. 不变量

1. 用户否定、数字、路径、时间和 scope 逐字保存。
2. Untrusted RPC input 默认不能授权 side effect。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `schemas/user-directive.schema.json`
- `tasks/T10-user-directive-capture.md`
