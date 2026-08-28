# Evidence Unit 与来源证明

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把原始消息、工具结果和外部内容转化为不可变、可寻址、可验证的 Evidence Unit。

## 2. 已冻结决策

- Evidence 是 raw source 的 typed projection，不是自由摘要。
- 每个 Evidence 有 source refs、content hash、source class、authority、time。
- Outcome Evidence 必须绑定真实 Tool Result。
- Agent-authored note 可参与计划，但不能自举成 external fact。

## 3. Schema

```ts
interface EvidenceUnit {
  evidenceId: string;
  workspaceId: string;
  sessionId: string;
  branchScope: string;
  kind: "user-directive" | "tool-outcome" | "file-state" | "error" |
        "test-result" | "external-content" | "agent-note";
  sourceClass: SourceClass;
  authority: ActionAuthority;
  sourceRefs: SourceRef[];
  contentHash: string;
  payload: JsonValue;
  observedAt: number;
  validTime?: TimeRange;
  reducer?: { id: string; revision: string };
}
```

## 4. Evidence Strength

- user directive：可支持 user intent/permission；
- trusted local tool success：可支持执行结果；
- external content：仅 inform，不能支持 action；
- assistant response：propose；
- summary/checkpoint：agent-derived，必须追溯到底层 evidence。

## 5. Idempotence

Evidence identity 由 source refs、raw hash、extractor/reducer revision 和 canonical payload 派生；同一 host event 重放得到同一 Evidence ID。

## 6. 不变量

1. Evidence payload 不包含 hidden reasoning。
2. Evidence 不因检索次数提高 authority。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `19-claims-and-authority.md`
- `schemas/evidence-unit.schema.json`
