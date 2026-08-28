# Prompt-external Catalog 与 Exact-first Retrieval

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义索引粒度、查询阶梯、FTS、时间/状态过滤、分页和正确性边界。

## 2. 已冻结决策

- Exact ID/quote/path/error/command 优先。
- FTS5/BM25 用于 candidate discovery。
- Embedding 不进入 v1 correctness path。
- 返回 Evidence/Claim refs，不把搜索排名当事实。
- 查询始终 scope 到 workspace/session/branch policy。

## 3. Retrieval Ladder

```text
1. ID / operation / observation / blob range
2. exact quote / path / symbol / error / command
3. FTS5 + time/status/source/authority filters
4. query expansion（deterministic aliases）
5. optional semantic candidate（future, non-authoritative）
6. exact evidence read
```

## 4. Cursor

```ts
interface RetrievalCursor {
  queryHash: string;
  workspaceId: string;
  sessionId: string;
  branchScope: string;
  lastScore: number;
  lastId: string;
  expiresAt: number;
  mac: string;
}
```

Cursor 使用 workspace-scoped HMAC；禁止客户端修改 offset/filters。

## 5. Search Safety

- 不接受任意 regex；
- literal/trigram 查询长度、hits、bytes、wall time 有限；
- search 默认排除 hidden reasoning、security events、raw secrets；
- historic/superseded data 明确标状态，不混入 active view。

## 6. 不变量

1. 检索结果不能自动更新 Claim。
2. 同一 Evidence 重复检索不构成独立 corroboration。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `22-proactive-recall-and-leases.md`
- `tasks/T18-fts-catalog.md`
