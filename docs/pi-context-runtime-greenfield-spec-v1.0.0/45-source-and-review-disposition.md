# 来源、评审核实与处置

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

记录用户调研、Claude Review、Pi 当前源码和旧 DCR 设计如何被吸收、替换或拒绝。

## 2. 已冻结决策

- 保留旧 DCR 的 Canonical/Serving、Directive、Evidence、Claim、Continuity、Cache、Verifier。
- 删除 DSH Fork/Service/RFC/Token Meter 修改主线。
- Pi Hook 语义以固定 commit 源码为事实。
- 所有项目自报 benchmark 标记为外部假设。

## 3. 处置矩阵

| 来源结论 | 处置 |
|---|---|
| 请求时 Context Runtime 优于递归单摘要 | 保留，映射 Pi `context` |
| Tool Result 写前 shaping | 保留，映射 `tool_result` |
| Prompt Cache 三段式/四区布局 | 保留并适配 active turn suffix |
| User raw message/directive lane | 保留并区分 pre-expansion/raw 与 expanded |
| DSH Request Builder Fork | 删除 |
| DSH single service owner | 替换为单 Extension + owner/conflict governance |
| DSH event transaction | 替换为 Pi JSONL + external Saga |
| 永不 replacement | 修改为 request-time view + periodic Pi native compaction |
| 每请求动态 Tool Schema | 延后/非目标 |
| Semantic first | 拒绝；deterministic MVP first |

## 4. 证据快照

Pi 参考 commit、包版本、公开 Hook、Session/Compaction 结构和安装方式固定在 `sources/pi-source-map.md`。用户材料原文保存在 `sources/user-provided/`，本规格不悄然替换其结论。

## 5. 不变量

1. 来源未支持的断言标为 inference 或 design decision。
2. 实现完成前不声称性能/安全门已通过。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `sources/`
- `BUILD-INFO.json`
