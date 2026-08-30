# 原设计要求与当前实现一致性矩阵

| 设计要求 | 当前模块 | 产品路径 | 判定 |
|---|---|---|---|
| Raw Tool Result 先持久化 CAS | blob store/raw-capture 存在 | tool_result hook 未注册；hook 也用 fake blob | 未实现 |
| Authenticated user 原文兜底 | InputCorrelator 存在 | input/message_end correlation 未注册且 event shape 不匹配 | 未实现 |
| Directive Ledger | capture/store 存在 | compaction 时临时正则扫描，没有持久 ledger | 部分原型 |
| Evidence/Claim/Continuity | 文件存在 | checkpoint claims/pointers 为空、continuity 硬编码 | 未集成 |
| Exact Search/Recall | tools 存在 | runtime 未传 evidence/search backend | 不可用 |
| Request-time materialization | materializer 存在 | 固定预算/常量 sections，stitch 破坏布局 | 原型，不满足规格 |
| Cache-aware layout | section/cache-plan 存在 | 无 previous receipt，最终 order 不受控 | 未实现 |
| Pi Native fallback | compaction hooks 存在 | rejected candidate 取消 compaction | 违反设计 |
| Durable candidate/fencing | worker 类型存在 | fake in-memory store/dummy snapshot | 未实现 |
| Multi-session isolation | contracts/store 字段存在 | s1/main/ws 固定 | 违反设计 |
| Exact recovery Gate | benchmark 规范存在 | live scorer 只测“不泄密” | 未执行 |
| Closed-loop environment validation | benchmark 规范存在 | no-tools + 文本 probe | 未执行 |

核心结论：**当前项目的主要差距是 composition/integration，不是模块数量。**
