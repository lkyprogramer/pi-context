# 研究基础与设计取舍

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

将用户提供的调研、Claude Review、Pi/DSH 实现对照和长期记忆研究转化为本项目的可执行设计原则。

## 2. 已冻结决策

- 入口过滤、请求选择、语义生成、可恢复指针和状态台账是互补机制。
- 生成式表示在某些任务上优于纯选择，但自由摘要不能成为唯一事实源。
- 行为级 continuation 比“摘要看起来完整”更重要。
- Prompt Cache、用户原话兜底和宿主集成复杂度属于 P0，而不是事后优化。

## 3. 机制映射

| 机制 | 本项目吸收方式 |
|---|---|
| Hypa 式入口减噪 | `tool_result` 冷存原文后执行 tool-specific reducer |
| instant 式可寻址外存 | Observation/Evidence ID + exact read/search |
| Smart Compact 式事实先行 | Evidence/Claim/Continuity + verifier |
| ACP 式主动管理 | 主动 recall 和可选 model nudge，但安全 Owner 仍是 deterministic policy |
| Pi 原生 Compaction | 周期性缩小宿主活跃历史；`session_compact` 作为 host commit signal |
| TRACE/paired continuation | 每个关键边界保留压缩前后可比 continuation fixture |

## 4. 对旧 DCR Review 的处置

- Cache：固定四区布局和 per-request cache receipt；
- 用户约束：新增 raw input/directive lane；
- DSH Fork：取消主线，Pi 公开 API 第一宿主；
- 规格漂移：Canonical Contract 只在 `06` 定义，Schema/Examples/Tasks 机械校验；
- 复杂度：W1 smoke gate 前不实现 Semantic/Embedding/在线学习。

## 5. 不变量

1. 第三方项目自报收益只能作为假设，不得写入 release claim。
2. 论文数字不直接外推到 Pi Coding Agent。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `sources/user-provided/`
- `45-source-and-review-disposition.md`
