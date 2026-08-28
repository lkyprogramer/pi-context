# Pi 集成可行性与基线冻结

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

记录 Pi 固定源码快照、公开扩展点、已验证能力、缺口和适配边界。

## 2. 已冻结决策

- 固定 Pi commit `938109e7259068ff736dbba3bed14c81af25abbe`，coding-agent `0.84.3`。
- `context` 是每次 LLM 调用前的 request-local messages pipeline。
- `tool_result` 位于工具执行后、ToolResultMessage 持久化前。
- `session_before_compact` 可取消或返回自定义 CompactionResult。
- `session_compact` 是 Pi 保存 CompactionEntry 后的确认事件。
- Extension Handler 无 priority/singleton，且异常通常被记录后继续。

## 3. 能力映射

| PCR 需求 | Pi API | 结论 |
|---|---|---|
| 请求物化 | `context` | 直接可用 |
| User raw input | `input` | 可用，需保存 pre-expansion 文本 |
| Top-level proactive recall | `before_agent_start` | 可用 |
| Raw Tool capture/reduce | `tool_result` | 可用，需冲突治理 |
| Action Gate | `tool_call` | 可用 |
| Host checkpoint | `session_before_compact` | 可用 |
| Commit acknowledgment | `session_compact` | 可用 |
| Background work | `agent_settled` | 可用 |
| State persistence | `appendEntry` | 可用；不进入 LLM context |
| Branch tracking | SessionManager leaf/tree APIs | 可用 |
| Request-local tool schema | 无直接返回字段 | 不纳入 v1 |

## 4. 关键限制

Pi 在运行 `context` handlers 前会复制消息数组，所以单靠 request-local 过滤不能让宿主处理成本长期有界。PCR 必须接管 Pi Compaction，周期性将活跃历史收敛到 checkpoint + recent tail。

Pi JSONL 与 PCR SQLite/CAS 不共享事务。系统采用 Saga 和启动恢复，不能写“原子跨存储提交”。

## 5. 不变量

1. 适配器只从 Pi 发布包公共 Export 导入。
2. Runtime capability probe 失败时不得进入 active mode。

## 6. 验证要求

- 固定 commit 的 Hook Contract Tests。
- 最低、当前支持、latest Pi 兼容矩阵。

## 7. 关联资料

- `07-pi-public-api-mapping.md`
- `36-compatibility-versioning.md`
