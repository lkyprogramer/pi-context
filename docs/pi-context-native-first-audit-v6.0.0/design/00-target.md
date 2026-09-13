# 目标设计（6.1 修订）：observe+history 是产品，balanced 是阈值触发的无损折叠

本页替代 6.0.0 的"稀疏冻结 epoch + exposure ledger + pin 胶囊"设计。修订依据：源码逐条核对（[findings](../audit/03-findings.md)）、Pi 0.85.1 源码事实（[05](../audit/05-native-pi.md)）、本地 4090 NInfer 栈的 prefix cache 实测（[07](../audit/07-local-stack.md)）、以及文献结论（[06](../audit/06-community.md)）。

## 产品定位

pi-context 不是"上下文压缩插件"。Pi 0.85.1 已经拥有 overflow 恢复、单 turn 内 split-turn 压缩、run 内阈值检查、compact-and-retry 和结构化摘要（[05 §6.1 第 9–11 条](../audit/05-native-pi.md)）；这些职责与插件竞争只会产生两套失效逻辑。6.1 的定位是 **Pi Native 之上的 evidence / recall + cache-aware projection 层**：

```text
Pi（唯一事实源）        session · branch · tool 执行 · compaction / split-turn / overflow / retry · context hook
pi-context              Evidence index + exact recall（observe）
                        Cache-aware frozen fold（balanced，阈值触发一次）
                        Usage / fold / cache telemetry + 本地评测
```

价值主张从"减少 token"改为：少发无价值历史、需要时逐字找回、折叠不破坏 prefix cache、每一步都有可复算的 usage 证据。

## 目标与非目标

**目标**：在官方 Pi 0.85.1 上，
1. `observe`（默认）：不改任何请求；提供 scope 安全、可分页、可逐字回读的 `pctx_history` 工具。
2. `balanced`（显式开启）：当上下文用量越过阈值时，一次性把**已被模型看过的旧工具结果**替换为可回读的短 stub，把用量拉回目标线以下，从而推迟或避免原生 LLM 摘要；折叠后前缀再次稳定，直到下一次阈值触发。
3. 每次请求记录 usage（input / cacheRead / output）与折叠事件，让用户在自己的 4090 会话里直接看到 prefix 命中和窗口用量变化。

**非目标**：不做 exposure ledger/ACK 协议、冻结 epoch 身份对象、pin 胶囊、语义摘要、第二 CAS、跨会话记忆、Pi fork、修改 `tool_result` 持久化内容、修改用户消息/assistant 文本/工具参数。

## 为什么改成"阈值触发"而不是"每 8 次成功请求重规划"

本地栈事实（[07](../audit/07-local-stack.md)）：NInfer `rolling-tool` prefix 复用在 Pi 追加式历史下命中约 85%；**任何对旧前缀的改写都让改写点之后的 KV 全部作废**，要按约 2000 tok/s 重新 prefill。文献事实：改前缀的代价必须批量支付一次（Anthropic `clear_tool_uses` 的 `clear_at_least`、Manus、oh-my-pi pruning、pi-condense 都是同一原则）。

因此折叠只在两个条件同时满足时发生一次：`ctx.getContextUsage().percent ≥ fold.triggerPercent` 且没有仍然有效的 plan。触发点之间所有请求 append-only，stub 字节固定。这比 6.0.0 的"累计 8 次成功请求 + 4096 token + 15%"更少地打断缓存，也不需要成功请求计数器和 ledger。

折叠的收益在本地栈上不是省钱，而是：(a) 推迟原生 compaction——它是一次冷 prefill 整段历史 + 摘要 decode + 之后再一次冷 prefill，且有信息损失；(b) 让会话在 262k 窗口内活得更久；(c) 折叠是无损的：原文在 Pi JSONL 里，`pctx_history` 按 ref 逐字回读。

## 目录（继续保留，删除三块）

```text
src/extension.ts            官方 ExtensionAPI 入口；session_start 加载配置
src/pi/adapter.ts           官方事件映射，使用官方导出类型
src/pi/source-reader.ts     当前分支 entry 读取、toolCallId → entry 映射
src/history/*               refForField、scoped FTS 索引、分页 read/search
src/projection/*            派生暴露、批次保护、阈值折叠 plan、纯内容替换渲染
src/telemetry/*             每请求 usage/折叠事件，无内容日志
eval/local/*                4090 本地评测套件（E01–E04）
删除：src/checkpoint/*、ExposureLedger、staging、semantic、pin 命令、eval/live-g4.mjs 的 host grader 路径
```

## 三种模式

| 模式 | Native 请求 | pctx_history | 折叠 |
|---|---|---|---|
| off | 原样 | 工具返回 disabled，schema 不变 | 无 |
| observe（默认） | 原样，同一引用返回 | 开启，scope 受限 | 无 |
| balanced（显式） | 越阈值时替换合法旧 toolResult 文本副本 | 同 observe | 阈值触发一次，之后冻结 |

配置文件 `~/.pi/agent/pctx.json` 与 `<cwd>/.pi/pctx.json`（项目文件需 projectTrusted），`schemaVersion: 6`。旧 `pctx-v5.json` 不迁移，存在时 `/pctx status` 显示 `ignored-legacy-config` 警告。加载错误必须在 status 中可见，不能静默回退 observe 后跑实验。

## 请求路径与不变量

1. `context` 事件：off/observe 直接 `return undefined`（不复制、不扫描 entries）。
2. balanced：从 `ctx.sessionManager` 取当前分支 entries（`getEntries()`/祖先遍历），用 `toolCallId` 把 messages 中的 toolResult 定位到 entry；映射不唯一则该消息不折叠。
3. **已暴露**由原生日志派生：toolResult entry 之后、同一分支上存在 `stopReason ∉ {error, aborted}` 且 `usage.totalTokens>0`（或 input>0）的 assistant entry。不需要 ledger、ACK、generation。重启后同样可算。
4. 候选资格：已暴露、纯 text block、`isError=false`、所属批次完整（每个 call 恰一个 result）、不在最近 `protectRecentBatches` 个完整批次、正文字节 ≥ `minFoldableBytes`。
5. 触发：`usage.percent ≥ triggerPercent`（默认 60）且当前无有效 plan。plan 按从旧到新折叠候选，直到估算用量 ≤ `targetPercent`（默认 40）或候选耗尽；估算净减少 < `minRemovedTokens` 则不建 plan（避免为几百 token 打断缓存）。
6. plan 冻结：`Map<entryId:blockIndex, Replacement>`；后续请求只应用、不重算；stub 字节不变。**plan 只能追加**（下一次阈值触发时在旧表上追加新条目），已有条目不改。
7. 失效：`session_compact`（清空；被压缩掉的 entry 已不在上下文，保留的 tail 回到原文，此时上下文本来就是冷的）、`session_tree`、`model_select`、`session_start`（切换/恢复会话）。不因追加普通消息失效。
8. 渲染：只替换白名单 toolResult 的 text block；消息数量、顺序、role、toolCallId、图片/未知块、user/assistant 内容不变；多个 text block 各自独立 ref 与 stub。runner 已 `structuredClone`，插件不再深拷贝，直接在副本上写。
9. 折叠一次后的第一条 assistant 响应，其 `usage.input` 应显著下降且 `cacheRead` 接近 0（前缀作废）；之后请求 `cacheRead/input` 应回到高比例。这两条是 D01/E03 的机制断言。
10. 不向 canonical 日志写任何内容；`pctx_history` 读原生字段并重新校验 hash 与当前祖先权限。

## stub 形式

```text
[pctx folded tool result; original retained in session log]
tool=bash call=toolu_01 outcome=ok bytes=48213 sha256=3f9a2c1e id=0a1b2c3d
head: "[INFO] Scanning for projects..."
read: pctx_history(action="read", ref="0a1b2c3d")  full ref: pctx:6:...
```

确定性生成；`head` 是原文第一非空行截到 `stubHeadChars`（默认 120）。`id=` 是 8 位 hex 的原生 entryId（多 text block 时为 `entryId:blockIndex`），`pctx_history read` 接受它作为短 ref 并在当前 session scope 内解析到完整 ref 后再做 hash 校验；小模型抄写长 base64 ref 容易出错，短 id 是为此加的。不编造 exit code、失败测试名或总结；`outcome` 只取 `isError` 字段。stub 不比原文短就不折叠。

## 索引和可恢复性

SQLite（`node:sqlite`，FTS5）只做可重建索引；一个 workspace 一个文件，行主键 `(workspace_id, session_id, entry_id, block_index)`。所有查询在排序/截取前应用 `session_id ∈ 当前 scope` 谓词并只返回可见祖先。增量：记录每 session 已索引 leaf，只 upsert 新 entry。`persistent` 必须显式 dbPath（默认 `~/.pi/agent/pctx/index.sqlite`），否则 memory-only；不把 `:memory:` 标成 persistent。worker 若不接线就删除。

## 如何判定 balanced 值得开

E03 在 4090 现网（不停 unit）上跑 [scenarios](../testing/scenarios.json)：
- 质量集（L01–L06，262k 生产窗口，native vs balanced）：不能出现 balanced 独有的 oracle 失败；折叠通常不触发，测的是 history schema 开销与无回归。
- 能力集（H01/H02，w64k 诊断窗口 + 预录种子历史，native/observe/balanced）：balanced 必须观察到 `foldApplied>0`、折叠后 `cacheRead` 归零再恢复、`pctx_history` 真实回读 ref 且 hash 匹配；native 观察到原生 compaction。
- 长会话（H03，262k，balanced，个人 dogfooding）：`/pctx status` 报告 usage 曲线与折叠次数。

决策：`observe-only` / `limited-balanced-trial` 两个出口，见 [testing/00-protocol](../testing/00-protocol.md)。若折叠没有推迟原生 compaction 或造成任何质量回归，停在 observe——这仍是完整交付。

## 6.2 候选（不在 6.1 范围，由 E03 证据决定是否立项）

外部反馈（[08](../audit/08-feedback-reconciliation.md)）建议保留 checkpoint 并升级为"source-backed verified delta"。6.1 仍删除 `src/checkpoint/*`（C01），原因：现有 capsule/pin 的内容形态（任务、进展、下一步、读改文件）与原生摘要重复；其注入方式改写 user 消息（F13）；且没有任何一手证据表明它优于"原生结构化摘要 + 精确回读"。

但反馈中有一个 Pi 原生确实不做、且可以**纯确定性**实现的子集，记为 6.2 候选 **post-compaction evidence delta**：

- 内容只含可从日志派生的事实：压缩前**未被同名工具后续成功覆盖**的 `isError=true` 工具结果（工具名、`toolCallId`、首行、ref）；压缩前被 edit/write 修改、之后没有任何 bash 结果的文件（"UNVERIFIED"）。不含约束提取、不含"forbidden claim"、不调用模型。
- 注入位置与时机：只在 `session_compact` 之后的第一次 `context` 事件，把一条固定文本块追加到 compaction summary 消息之后（模型视图，不落日志）；此时前缀本来就是冷的，追加不产生额外 cache 失效；随后冻结到下一次压缩。
- 立项条件（机械）：E03 报告中 native 或 balanced 臂在 H02 出现 `lost evidence ≥ 1`（模型无法逐字引用早期失败断言）且同 episode 内 `pctx_history search` 本可命中该断言。若 H02 三臂都没有丢证据，此候选关闭。

在此之前，任何形式的 pin、capsule、staging 都不重新引入。

### 6.2 候选二：内联 ref 标记（借自 Codex `history` 的 `[id: ...]`）

来源与核对见 [09-codex-context-management](../audit/09-codex-context-management.md)。Codex 在每条非 assistant item 尾部贴 `[id: ...]`，模型无需先 search 就能 `read_item`。Pi 上的等价物：

- 在 `tool_result` 事件里对**文本块**追加一行固定标记 `[pctx ref pctx:6:<entryId>:<blockIndex>]`。这是内容创建时一次性写入、之后 append-only，对 prefix cache 安全；与 6.1 拒绝的"用 `tool_result` 缩短内容"不同（[02 §8](02-fold-algorithm.md)）。
- 代价：每条结果约 15–25 token；`FieldRef.hash` 必须改为对**去掉标记后的正文**计算，`pctx_history read` 返回时也剥离标记，否则 B01 的 hash 校验与 stub 的 `sha256` 会自指。
- 不对 `isError`、图片、非文本块加标记；`stubHeadChars` 取首行时跳过标记行。
- 立项条件（机械，取自 E03 报告）：H01/H02 的 observe 或 balanced 臂中出现 `historySearches ≥ 1 且 verifiedReads = 0` 的 episode ≥ 2——模型知道有工具、也去搜了，但没能定位到 ref。若模型根本不调用工具（`historySearches = 0`），此候选不适用，问题在候选三。

### 6.2 候选三：模型侧预算提示（借自 Codex token-budget reminder）

Codex 在剩余 ≤ 6144 token 时向模型注入一次 `<context_window_reminder>`，让模型在窗口耗尽前主动收尾/记录。Pi 上的等价物：

- 在 balanced 触发折叠的**同一次** `context` 事件里，于最后一条 user 消息之前追加一条固定文本块（developer 语气，≤ 60 token）："上下文已折叠 N 条旧工具结果；需要原文时用 `pctx_history read(ref)`，ref 在 stub 中。"与折叠合并在同一次前缀作废里，没有额外 cache 代价；随 plan 冻结，随 plan 失效。
- 不做逐请求剩余额度注入（每请求改前缀）；不做 `get_context_remaining` 工具（Pi 已有 `/pctx status`，而模型侧额度对不会记笔记的模型没有用处）。
- 立项条件：H01/H02 的 balanced 臂中出现 `folds ≥ 1 且 historyReads = 0 且 historySearches = 0 且 oracle 失败` 的 episode ≥ 2——stub 在上下文里但模型从未尝试搜索或回读。

两个候选都不改 6.1 的 12 任务；E03 报告的 `candidate` 段会机械地列出触发了哪一个（[00-protocol 规则 6](../testing/00-protocol.md)）。Codex 的第三个部件——模型自写 `notes` 替代摘要——**不借**：它依赖被专门训练的模型与后端强制的 fallback 窗口，对本地 Qwen 没有保证，且正是 6.1 拒绝的第二套 LLM 摘要。
