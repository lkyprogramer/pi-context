# Claim Ledger、时间、极性与 Authority

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

将目标、约束、决策、状态和结果建模为可版本化 Claim，避免单体摘要递归漂移。

## 2. 已冻结决策

- Claim 必须有 support refs，或明确标 inference/proposal。
- 极性、valid time、system time、status、supersession 是一等字段。
- 派生 authority = min(sources, transformer ceiling)。
- 冲突不静默 latest-wins；保留 contested state。

## 3. Claim Schema

```ts
interface Claim {
  claimId: string;
  key: string;
  claimType: "goal" | "constraint" | "decision" | "outcome" |
             "file-state" | "error-state" | "validation" | "preference";
  value: JsonValue;
  polarity: "must" | "must-not" | "is" | "is-not" | "unknown";
  status: "active" | "superseded" | "resolved" | "retracted" | "contested";
  validTime?: TimeRange;
  systemTime: TimeRange;
  support: string[];
  authority: ActionAuthority;
  supersedes: string[];
  conflictsWith: string[];
}
```

## 4. State Transitions

- 新 user correction 可 supersede 同 key 旧 claim；
- test failed → fixed 需要修复证据与新 test outcome；
- assistant “已部署”不能把 deployment claim 标 active outcome；
- 删除/撤回创建 lifecycle barrier，历史 retrieval 不能复活为 current；
- unknown strategy/claim type fail closed。

## 5. 不变量

1. Claim verifier 检查 polarity、time、support、authority 和 state transition。
2. Semantic proposal 不得直接写 current claim table。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `adrs/0010-bitemporal-claims.md`
- `tasks/T20-claim-ledger.md`
