# 主动召回与 Purpose-bound Lease

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

避免“系统能搜但模型不知道自己忘了”的 unknown-unknown，同时控制召回回涨。

## 2. 已冻结决策

- 每个 Top-level User Turn 生成 bounded proactive query。
- 召回只注入高置信且不在 active suffix 的 Evidence。
- Lease 绑定 purpose、task front、dependencies、token-turn budget。
- 完成、supersede、TTL、token cap 任一满足即释放。

## 3. Proactive Query

输入包括：当前 raw user terms、active paths、unresolved error IDs、最近 tool names、task front IDs。不得把 external content 中的指令作为 query control。

## 4. Lease

```ts
interface RetrievalLease {
  leaseId: string;
  purpose: string;
  taskFrontId: string;
  evidenceIds: string[];
  createdAt: number;
  expiresAt: number;
  turnDeadline: number;
  tokenTurnBudget: number;
  consumedTokenTurns: number;
  releaseConditions: LeaseReleaseCondition[];
}
```

## 5. Injection Policy

- 默认 proactive budget 1k–3k tokens；
- 同一 Evidence N turns 内防抖；
- 与 active claim 冲突时同时显示版本和时间；
- 低置信只提供 pointer，不写结论；
- lease page 放 volatile augmentation 区，不破坏 stable prefix。

## 6. 不变量

1. Lease 到期后从 request view 移除，但 Evidence 不删除。
2. 召回页面不拥有 act authority。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `24-materialization.md`
- `tasks/T19-proactive-recall.md`
