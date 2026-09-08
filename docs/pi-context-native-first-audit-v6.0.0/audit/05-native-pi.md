# 最新官方Pi上下文压缩：应保留的底座与仍可优化的部分

研究快照：官方`earendil-works/pi` main `b2602be77cb7b0de45dd616407fd210daa48aa75`，源码package声明0.85.1。分支测试清单的installed Pi gitHead另有d981…，原规格还固定9767…；**同为0.85.1不代表源码逐字相同**。本表是最新main源码分析，不宣称已发布npm包一定包含相同代码。[S07–S10]

## 当前算法

1. 用最后一次有效assistant usage作为锚，加上之后消息的估算；过滤error/aborted/全零usage。阈值`contextTokens > contextWindow-reserveTokens`，默认reserve16384、recent20000。
2. 当前`AgentSession._installAgentNextTurnRefresh()`在下一次assistant响应前调用`_compactBeforeNextAssistantResponse()`，可在同一agent run的工具批次完成后压缩。不能再复述旧issue“必须等整个agent结束才检查”。但这段检查主要用messages估算，并不是对所有最终provider编码的一次精确计价证明。
3. `findCutPoint()`从末尾累计，选user-like/assistant合法边界，绝不以toolResult为切点。大的不可分割tail可能超过目标；recent20000是保留目标不是硬成功保证。
4. `prepareCompaction()`重复压缩从上次`firstKeptEntryId`继续，不从旧compaction事件之后简单截断；重建真实上下文估tokensBefore。
5. 用Goal、Constraints & Preferences、Progress、Decisions、Next Steps、Critical Context结构摘要；previousSummary和新增历史迭代更新。split-turn分别概括早期历史和turn前缀，再合并。
6. 序列化工具结果仍只保留前2000字符并标注截断；调用参数和可见assistant文本也进入摘要。当前源码还序列化thinking，插件不应把这理解成允许任意导出hidden内容。
7. 合并read/write/edit文件路径；正常summary的error、length stop和tool-call输出被拒绝；摘要调用走retryAssistantCall，cacheRetention=none，路由sessionID由调用者提供或新生成。usage包含摘要工作。
8. 持久化CompactionEntry后重建活动messages；公开hook暴露preparation、`compactionEntry`、reason和willRetry。[S07–S10]

## 本分支不是另一种摘要算法

| 层 | 原生 | 当前native-first目标 | 当前实际状态 |
|---|---|---|---|
| 持久会话 | Pi JSONL树 | 同一事实源 | 已做到 |
| 首次工具观察 | 原文送模型 | 原样首次送模型 | observe做到；balanced暴露账本不足 |
| 历史噪音 | 等原生compact | 成功看过后冻结旧纯文本投影 | 模块在，端到端尚有ref/epoch问题 |
| 总结 | 结构化LLM+原文tail | 保持同一Native | 已委托Native |
| 精确恢复 | 无本插件history工具 | scoped原生entry read/search | 单块样例有信号，多块/分页/隔离缺陷 |
| 小范围重要原话 | 尽力摘要 | 人工pin胶囊 | 当前胶囊位置/引用不对 |
| 提前摘要 | 不在本层保证 | 本轮不做 | 合理延期 |

## 推荐优化顺序

先补“摘要截断后仍能找回原始字段”；再对成功看过的巨大观察做稀疏投影，代价显式计入cache重建；最后才考虑pin胶囊。如果真正瓶颈是原生摘要等待而非遗忘，可单独实验专用摘要模型或异步准备。不要把这三个不同问题同时改掉再只测一个总分。

注意：最新Pi阈值先看canonical/usage路径，插件请求投影不等于减少宿主内存。保留原生compact仍有必要。若宿主先执行compact，插件无需强抢控制权；映射不可靠或预算未知就透传当前请求。

## 6.1 修订：对本地源码 `/Users/luo/Documents/github/pi` 的逐行复核

以下事实取代上文与 6.0.0 其他页中相冲突的表述（复核对象 `packages/coding-agent/src/core/`，0.85.1）：

1. **阈值锚点是真实 provider usage，插件投影会影响它。** `agent-session.ts:2208-2231` `estimateContextTokens()` 取最后一条有 usage 的 assistant 的 `usage.totalTokens`（或 input+output+cacheRead+cacheWrite），再加其后消息的字符估算。折叠后的第一条 assistant 响应带的是**折叠后**上下文的 usage，Pi 据此判断是否压缩。因此"插件投影不等于减少宿主内存"这句只对内存成立；对**压缩触发**而言，投影确实推迟原生 compaction。这是 6.1 balanced 设计的前提。
2. **`context` 事件的 messages 已被 runner 深拷贝。** `extensions/runner.ts` 的 `emitContext` 先 `structuredClone(messages)` 再传给扩展，返回值经合法性校验（只接受 `messages` 数组）。插件不需要再克隆；返回 `undefined` 表示不改。
3. **`tool_result` 事件可修改持久化内容**（`content/details/isError`），`context` 事件只修改本次请求副本。6.1 明确不使用 `tool_result` 缩短内容（会破坏"原文在日志里"）。
4. **压缩可以在同一 agent run 的工具批次之间发生**（`_installAgentNextTurnRefresh` → `_compactBeforeNextAssistantResponse`）。所以折叠 trigger 必须明显低于 Pi 阈值（默认 60% vs 93.75%），且插件不能假设"用户 turn 边界之前不会压缩"。
5. **`session_compact` 事件字段是 `compactionEntry`**（`types.ts` `SessionCompactEvent{compactionEntry, fromExtension, reason, willRetry}`），不是 `entry`。当前 adapter 读 `event.entry` → 永远 undefined（F02）。
6. **`ctx.getContextUsage()`** 返回 `{tokens, contextWindow, percent}`，`tokens` 在压缩后首请求可能为 null；扩展可在 `context` 事件中调用。这是 6.1 折叠触发的唯一输入。
7. **`SessionCompactEvent.willRetry=true`** 表示本次摘要失败将重试，不计为一次完成的压缩。
8. Pi 对工具结果的持久化截断（bash 2000 行 / 50KB）与摘要序列化时的 2000 字符截断是两回事：前者决定"日志里有什么"，后者决定"摘要看到什么"。`pctx_history` 只能回读前者留下的内容；被 Pi 截断的部分对任何插件都不可恢复。
9. **run 内阈值检查的顺序与输入**（2026-09-08 二次复核，回应外部反馈对 #128/#330 的描述）：`agent.prepareNextTurnWithContext` → `_compactBeforeNextAssistantResponse(turn.context)` 先于 `agent-loop.ts:288` 的 `transformContext`（即 `context` 扩展事件）执行；它的输入是 `estimateContextTokens(agent.state.messages)` = 最后一条真实 usage + 其后**原生**消息的字符估算。所以折叠对 Pi 阈值的影响只经由"下一条 assistant 的真实 usage"传导，折叠当次请求 Pi 看到的仍是未折叠估算；trailing 部分永远按原生正文估算。这进一步说明 trigger 必须留出至少一个请求的余量（60% vs 93.75% 足够）。
10. **#128（under-compaction）已在 0.85.1 落地**：`compaction.ts:403 findCutPoint()` 返回 `isSplitTurn`，可在单个超长 turn 内的 assistant 边界切开，前半段并入摘要（`turnPrefixMessages`，`compaction.ts:737-739`）；`_checkCompaction` 覆盖 overflow-with-retry / overflow-without-retry / threshold 三种自动路径，最多一次 compact-and-retry（`_overflowRecoveryAttempted`）。**overflow、within-turn 应急裁剪、retry 全部是宿主职责**，6.1 不实现任何一项；插件唯一与压缩有关的行为是 `session_compact` 后清空 plan。
11. **原生摘要结构**（`compaction.ts:471-532`）：Goal / Constraints & Preferences / Progress(Done/In Progress/Blocked) / Key Decisions / Next Steps / Critical Context，末尾 `formatFileOperations(readFiles, modifiedFiles)`；`CompactionDetails{readFiles, modifiedFiles}` 持久化在 compaction entry 的 `details`。任何"任务是什么/做了什么/下一步/读了哪些文件"形态的插件 checkpoint 都与之重复，6.1 因此不再保留 capsule/pin（见 [08](08-feedback-reconciliation.md) 与 [00-target §6.2 候选](../design/00-target.md)）。

对本包其他页面的影响：6.0.0 的"exposure ledger / ACK / generation"来自不信任日志派生的假设；上述第 1、6 条使派生暴露（[02-fold-algorithm §2](../design/02-fold-algorithm.md)）与 usage 触发足够。
