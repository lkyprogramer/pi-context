# Continuity Ledger 与任务工作面

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 Agent 继续工作的控制状态，不让目标、错误、外部副作用和下一步被一篇摘要压扁。

## 2. 已冻结决策

- active/parked/completed/superseded task fronts 分离。
- external side effects 与 conversation branch 分离。
- unresolved error 和 validation state 有明确生命周期。
- next safe action 必须带 guards、evidence 和禁止重复动作。

## 3. Ledger

```ts
interface ContinuityLedger {
  revisionId: string;
  parentRevisionId?: string;
  cursor: HostSessionCursor;
  taskFronts: {
    active: TaskFront[];
    parked: TaskFront[];
    completed: TaskFront[];
    superseded: TaskFront[];
  };
  constraints: ClaimRef[];
  decisions: ClaimRef[];
  unresolvedErrors: ErrorState[];
  externalSideEffects: SideEffectState[];
  validationState: ValidationState[];
  changedArtifacts: ArtifactState[];
  delegations: DelegationState[];
  nextSafeActions: SafeAction[];
}
```

## 4. Error 生命周期

`observed → diagnosed → fix-applied → revalidated → resolved`。缺失任意阶段不得直接从 observed 跳 resolved。

## 5. External State

文件改动、进程、数据库写入、部署、邮件/消息发送均记录 side effect ID、tool evidence、revalidation command 和 rollback availability。Tree navigation 时必须重新显示未回滚副作用。

## 6. 不变量

1. Ledger overflow 是 hard failure，不允许 truncate active constraints/errors。
2. Completed item 不能自动删除其 supporting outcome evidence。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `schemas/continuity-ledger.schema.json`
- `tasks/T23-continuity-ledger.md`
