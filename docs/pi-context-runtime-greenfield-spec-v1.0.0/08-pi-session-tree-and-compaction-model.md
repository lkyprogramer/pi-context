# Pi Session、Tree 与 Compaction 模型

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把 Pi JSONL Tree、SessionEntry、CompactionEntry、CustomEntry 和 Branch 行为映射到 PCR 状态。

## 2. 已冻结决策

- Pi Session JSONL 是 Host Transcript Authority。
- 当前 branch 由 leafId 与 parent chain 定义。
- CustomEntry 不进入模型，只保存小型 PCR Receipt/Head。
- CompactionEntry 是 Pi 活跃上下文的 durable checkpoint。
- Tree rewind 不回滚外部副作用。

## 3. Cursor 与祖先关系

```ts
interface PiBranchCursor {
  sessionId: string;
  leafId: string | null;
  lineageEntryIds: string[];
  lineageHash: string;
}
```

`lineageHash` 由当前 branch 上按顺序的 entry IDs 做 canonical hash。PCR Generation 绑定 leafId；当前 leaf 只能读取其祖先 generation，不允许读取 sibling branch 的 active state。

## 4. Pi Entry 使用

| Entry | PCR 使用 |
|---|---|
| message | Host source，建立 hostMessageId/Tool correlation |
| compaction | Host checkpoint + details 中的 PCR generation/head refs |
| branch_summary | 默认视为 agent-derived evidence，不能自动升权 |
| custom | operation receipt、head pointer、compat/runtime version |
| custom_message | 仅用于必要的用户可见提示；不作为常驻 memory 主路径 |

## 5. Fork/Resume/Tree

- `session_start`：重建 cursor，运行 catch-up 与 Saga recovery；
- `fork`：新 session 继承可见 ancestor Evidence，但创建新的 session scope；
- `session_tree`：切换 active generation；
- 外部 SideEffect 保持真实状态，Continuity 必须提示“conversation changed, external world unchanged”。

## 6. 不变量

1. 跨 sibling branch 的 active claim 不得默认合并。
2. 旧 Compaction Summary 只拥有 agent-derived authority。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `28-session-lifecycle-branching.md`
- `schemas/host-session-cursor.schema.json`
