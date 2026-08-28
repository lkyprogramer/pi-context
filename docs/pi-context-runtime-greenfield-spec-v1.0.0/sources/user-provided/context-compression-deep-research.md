# Agent 上下文压缩：从实现到设计 —— 深度综合调研报告

> **说明**：本报告系统调研了 **Pi 原生 compaction**、**deepseek-ai/deepseek-harness（dsh-compaction-basic）**、**TsFreddie/dsh-compaction-instant**，以及社区主流插件（pai-acp / acp-kernel、pi-smart-compact、Hypa、pi-context-tools、DCP/Sleev），同时覆盖理论论文（Context Compaction Theory、repository-level compression 实证）与 Agent 框架层实践（LangChain Deep Agents、Claude Code/MCP context engineering）。最后提出一套更优的分层上下文守护系统设计。

---

## 0. 核心命题：Agent 记忆到底该是什么样？

在深入实现之前，先回到用户提出的根本问题：**Agent 记忆究竟是什么样的？** 所有压缩方案的分歧，本质上都源于对同一组问题的不同回答：

| 维度 | 答案选项 | 各方案的立场 |
|---|---|---|
| **压缩由谁决定** | 框架硬规则 vs 模型自主决策 | Pi/Basic 是框架阈值；ACP/DCP/Smart 把何时压、压什么交给模型工具 |
| **压缩的本质** | 选一个子集保留 vs 生成新摘要 | 理论论文证明二者不等价，生成（摘要）严格强于选择 |
| **压缩的时机** | 满后再补 vs 事前预防 vs 无感前置 | Hypa 在入口拦截；ACP 用 nudge 预告；dsh-instant 追求零延迟 |
| **压缩的代价** | 纯有损丢弃 vs 近无损可回滚 | Instant 用 `(seq N)` 指针保留 100% 原始内容；ACP 提供 decompress |
| **记忆的层次** | 单一线性上下文 vs 分层图谱 | Smart-compact/agentmemory 做持续 ledger + 图；Session Tree / Git 式 checkpoint 提供分支与回溯 |

**贯穿本报告的共识结论**：最佳实践正在从"到达上限再压缩"转向 **"不该进上下文的，一开始就不要让它进去"**（Hypa）、**"让 Agent 自己在合适时机主动遗忘"**（ACP/DCP/Deep Agents）和 **"无感知的前置预热"**。而这一切的基石是一个分层记忆模型：

```
┌───────────────────────────────────────┐
│   Long-term Memory  持久记忆          │  → SQLite/graph，跨会话，事实级，可检索
├───────────────────────────────────────┤
│   Session Memory    会话记忆          │  → 结构化摘要树 (ACP 三阶) + 近无损指针日志
├───────────────────────────────────────┤
│   Working Context   工作上下文        │  → 当前任务相关最新对话 + 待完成事项
├───────────────────────────────────────┤
│   Pre-entry Filter  入口预过滤        │  → 确定性 reducer，让垃圾不进上下文
└───────────────────────────────────────┘
```

---

## 1. 理论基础：上下文压缩的两个游戏与三种范式

### 1.1 Context Compaction Theory（arXiv:2608.01326）

这篇论文首次对上下文压缩做了形式化研究，提出了两个博弈来刻画实践中两种算法策略：

- **Context Selection Game（选择博弈）**：从已积累的 agent 状态中选出一个子集保留 —— 对应"剪枝/丢弃/截断"类方法（如固定比例丢弃旧消息、最近 N 条保留）。
- **Context Generation Game（生成博弈）**：把 agent 状态压缩成任意长度的 bounded message —— 对应"LLM 摘要/checkpoint"类方法（Pi basic、dsh-basic、ACP）。

**核心定理**：生成博弈 ⇔ 单向通信复杂度（one-way communication complexity）。回答一组查询所需的最小压缩预算，等于诱导通信问题在同等误差下的单向通信复杂度。这意味着：

1. 已有的通信复杂度上界可以直接转移到上下文压缩；
2. 可以衡量任意部署的压缩算法相对于最优策略的性能差距（论文以 Anthropic 的 context compaction endpoint 在集合成员查询上的 case study 示范）；
3. **生成严格优于选择**：存在一组查询，使"生成摘要"所需的预算严格小于"选择子集"。这从理论上解释了为什么摘要类方法（ACP、Basic、Smart）通常比简单丢弃旧消息更省空间且更保持可用性。


### 1.2 三种技术范式：离散 token / 连续潜在向量 / 视觉 token（arXiv:2604.13725）

针对仓库级代码智能任务的实证研究对比了三大类方法：

| 范式 | 代表 | 机制 | 关键发现 |
|---|---|---|---|
| **离散 token 序列** | 截断、基于规则的丢弃、关键词抽取 | 显式保留/丢弃原始 token | 基线；在高压缩比下性能下降明显 |
| **连续潜在向量** | 嵌入式压缩、soft-prompt 式浓缩 | 把上下文映射到连续向量再解码 | **4× 压缩下 BLEU 比全上下文高 up to 28.3%** —— 它是在"过滤噪声"而非单纯截断 |
| **视觉 token** | 图像化/结构化的 token 表示 | 将代码/文档转为图像 token | 端到端延迟降低 up to 50% |

两个工程结论：所有范式都降低推理成本；视觉与文本压缩在高中压缩比下都将端到端延迟降低约 50%。

### 1.3 工程方法论：Select / Write / Compress / Isolate（LangChain context engineering）

社区归纳的四条路径：

- **Select（选择）**：检索时只挑选最相关的 chunk（RAG 式）。
- **Write（重写）**：写入时就控制内容质量，减少冗余源头。
- **Compress（压缩）**：事后把上下文变密（本报告主体）。
- **Isolate（隔离）**：通过子 agent/沙箱隔离，父上下文天然干净（Hypa 的部分思想、ACP delegate）。

---

## 2. 官方平台实现

### 2.1 Pi 原生 compaction（https://pi.dev/docs/latest/compaction）

**定位**：阈值触发的结构化摘要替换，配合分支（/tree）总结。

**触发条件**：`contextTokens > contextWindow − reserveTokens`，`reserveTokens` 默认 **16384**（保护系统提示 + overhead）。可配置在 `~/.pi/agent/settings.json` 或项目 `.pi/settings.json`。

**参数**：
- `keepRecentTokens`（默认 **20000**）：压缩后完整保留的最新轮次 token 上限。
- `reserveTokens`（默认 **16384**）：安全余量。
- 手动 `/compact [指令]` 可聚焦摘要内容。

**五步流程**：
1. **找切割点（cut point）**：从 newest message 倒推累加 token 估计，直到达到 keepRecentTokens；切点在 turn 边界；若切到 turn 中间，会把该 turn 的前缀单独摘要再合并（split-turn 处理）。
2. **提取待汇总消息**：从前一个保留边界（或会话起点）到切割点。
3. **生成摘要**：调用 LLM 生成**结构化摘要**；若旧消息超出单次调用预算，分块逐段摘要后**合并**，并把上一份 compaction 摘要作为迭代上下文传入，形成**层级压缩（summary of summaries）**。
4. **追加条目**：保存 `CompactionEntry`（id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore, usage），记录被替换区段的第一个保留 entry ID。
5. **重建上下文**：下一轮请求 = summary + 从 firstKeptEntryId 开始的原始消息。

**数据结构**：`CompactionEntry` 与 `BranchSummaryEntry` 同源，均含 `readFiles[]` / `modifiedFiles[]`，累积记录文件操作。

**序列化**：summarization 前用 `serializeConversation` 把消息转成 `[User]: … / [Assistant tool calls]: read(path="..."); edit(...) / [Tool result]: …` 文本；**tool result 被截断至 2000 字符**并插标记，以控制 summarization 请求预算。

**扩展点（hooks）**：
- `session_before_compact`：extension 可取消或返回自定义 summary（含 messagesToSummarize, turnPrefixMessages, previousSummary, fileOps, tokensBefore, firstKeptEntryId, settings 等上下文）。
- `session_compact_failed`：压缩失败时通知（reason, errorMessage, aborted, willRetry）。

**分支总结（branch summarization）**：`/tree` 导航时，找到共同祖先节点，收集旧分支叶子到祖先之间的条目，按预算倒序准备后生成 `BranchSummaryEntry` 插入新叶子。这是"离开某段工作流前留下备忘录"的原生支持。

**关键洞察**：Pi 原生是典型的**被动阈值 + LLM 生成摘要 + 层级合并**；它在 cut-point 上做 turn 感知的切割、在序列化阶段截断 tool result、并用文件操作追踪保证跨压缩轮次的语义连续性。它的局限是：纯框架规则触发（模型不决定何时压）、一次性的自由文本摘要（非结构化、难检索）、mid-turn 切分会导致信息割裂风险。


### 2.2 DeepSeek Harness：compaction 能力族（deepseek-ai/deepseek-harness）

DeepSeek Harness 把 compaction 设计成一个清晰的 **capability seam**，拆成四件套，任何 tokenizer/template 后端都可插拔：

```
packages/
  compaction/                     ← Service Definition（抽象契约 + compaction/* 事件词汇）
  compaction-basic/               ← Service Provider（token-pressure + LLM summarization 后端）
  compaction-tool-result-pruner/  ← 可选 model-free 工具结果裁剪伴侣
  command-compact/                ← 人类命令消费者 (/compact)
```

**抽象契约 (`ctx.compaction`)**：三个**仅日志**的 session event（绝不直接加入 surface）：

| Event | 负载 | 作用 |
|---|---|---|
| `compaction/start` | `{ turn }` | 获取日志锁（数字=自动轮次；null=手工独立尝试） |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 安全摘要投影 + 完整 provider 输出 + 被影子掉的表面区间与 seqs + token 计数 + 摘要调用的 envelope |
| `compaction/end` | `{ turn, error? }` | 释放锁；error 记录失败尝试 |

锁的语义很讲究：**start 先于 summary，end 最后**——崩溃留下的 unmatched start 是一个可检测的孤儿锁，而不是一个虚假声称完成的 end。manual `compactRegion` 要求一个打开的 turn；pressure 路径挂在 serial `agent/pre-step`；provider-confirmed overflow 进入 `agent/request-error`。

**`compaction-basic` 后端机制（核心）**：
- **测量（Measurement）**：独占 `ctx.tokenMeter`，在每次 step-boundary 评估 canonical logged envelope + current surface 的真实 token 消耗——**包含系统提示、tools schema、routing、assistant completion、tool results、buffered context**。
- **路由策略**：从拥有最新 durable provider/model route 的 adapter 解析容量，然后按比例缩放得到具体 token budget（`thresholdRatio` 默认 0.8、`retainRatio` 默认 0.16 或与 `retainTokens` 互斥）。
- **Model-free pruning（模型免费裁剪）**：压力达标后，先经可选 `ctx.toolResultPruner` 把过大的 tool result 重写到 head+标记+tail，然后**重新计量**；若降至阈值以下就**跳过 summarization**。
- **保留策略（Retention）**：压缩最旧的整 surface unit，同时保留一个 recent tail；通过 `toolPairingBalancedBefore/After` 边界辅助实现平衡的 tool-call/result 切割。**turn boundary 不保护 runaway turn 内部的旧步骤**。
- **KV-cache 友好（KV-cache aware replay summarization）**：这是 dsh 的设计亮点。摘要调用会**原样回放对话前缀**（相同的 system prompt、tools schema、shadowed region 消息、image 引用），只追加一条 compaction instruction 作为最终 user message——因此**重用 provider 的温暖前缀 cache**，只有 instruction 和生成的摘要在 cache 之外。adapter 设 `GenerateOptions.purpose = compaction`（DeepSeek adapter 发 `x-deepseek-harness-compact: 1`），不影响模型可见体。
- **Framing**：替换后的 user message 用 `<compacted-summary>` 标签包裹；preamble 明确告知模型这是 checkpoint，继续工作即可，不要 acknowledge。
- **收敛与重试**：`compactionRetries`（默认 1）重试 HEAD checkpoint 压缩；拒绝**没有收缩**的摘要；重试耗尽则抛异常。
- **Overflow 恢复**：provider 确认的 CONTEXT_WINDOW_EXCEEDED 可绕过正常压力逻辑，prune → 一次最大平衡头部缩减（保留最新不可分割 unit），每次 `surface.replaceGeneration` 前进都授权重试。
- **结构化 checkpoint 指令**：最终 user message 是一条固定结构的八段指令——Primary Request/Intent、Key Technical Concepts、Files and Code、Errors and Fixes、Pending Jobs、Current Work、Next Step、Critical Context，要求 terse bullets、保留精确路径/命令/错误串/签名/数值，并规定**合并已有 `<compacted-summary>` 区块**（保留仍为真的事实、丢掉陈旧的、合并新信息）。
- **失败处理**：summary/changed-span 失败会关闭并留下日志痕迹但**保持 surface 不变**；操作型压力失败仅警告并继续。

**`compaction-tool-result-pruner` 伴侣**：对过预算的 `tool/result` surface node 做 head/tail 重写（默认 thresholdChars=8192 / headChars=4096 / tailChars=1024），保留完整原始事件在 append-only session log；**无模型调用**；第二次 pass 不会再次产生替换。局限：按 code point 而非 token 计费、语法性裁剪（看不懂哪行更重要）、grapheme 可能断裂。

**`command-compact`**：人类 `/compact` 命令，走 `compactNow()`，可在低于阈值的空闲期主动做一次有用缩减。

**设计哲学**：dsh 把 compaction 视为**一条可选 capability 而非 agent loop 的脊椎**；测量与存储分离（tokenMeter 独立）；一切用事务 + 日志事件记录保证可审计与可恢复。


### 2.3 dsh-compaction-instant（TsFreddie / @deepseek-ai/dsh-compaction-instant）

**定位**：basic 后端的**即插即用替代品**——用确定性 conversation compiler（受 lllyasviel/VCC 启发）替换 LLM summarization，**零模型调用、毫秒级、near-lossless**。

**核心机制**：
- **single deterministic pass over shadowed nodes**，无网络、无模型、无 KV-cache 担忧。
- **输出只含原始 token**，无任何 paraphrase；每一次剪切都打标记并指向 durable `seq N`；之前的 checkpoints 逐字拷贝。
- **全部被切掉的内容仍然可通过 `(seq N)` 指针从 durable session log 恢复**——真正的 near-lossless，不是有损摘要。
- Tool row 永远是一行；tool call 永不重缩放，封顶 **≤128 tokens**；tool result **不再占用 entry**，改用 `-> result N` 指针指向。
- 超长 user/assistant 文本截断到其 budget，标 `...(truncated from seq N)`，elision 指明持有完整内容的 durable event。
- 最新内容生存；达到上限时**先删最旧的 tool rows**，再删其余；tool call 绝不为了省空间而被消灭。
- **Tokenizer**：ASCII 字母串 + 数字串各算 1 token；标点按字符；空白不计；其他 code unit 自成一 token；CJK 1 码点 1 token（"你好，世界！" = 6）；emoji 2 token（surrogate pair）。估算密度：非 CJK ≈ 0.3 tok/char，CJK ≈ 0.6 tok/char。

**配置**（schemastery 校验，Cordis browser 暴露子集）：

| 键 | 默认 | 含义 |
|---|---|---|
| `thresholdRatio` | 0.5 | 触发自动压缩的上下文窗口分数 |
| `retainTurns` | 1 | 逐字保留的最近完整轮次数 |
| `retainTokens` | 5120 | 保留区的硬 token 上限 |
| `auto` | true | 注册 step-boundary pressure 与 overflow 恢复 |
| `checkpointCap` | 65536 | 单个 checkpoint 的 compiler-token 总预算 |
| `textTokens` | 512 | assistant text block 预算 |
| `userTextTokens` | 1024 | user text block 预算 |
| `toolCallTokens` | 128 | tool-call one-liner 预算（永不重缩放） |
| `stripNoiseXml` | true | 剥离配置的 noise XML 包装 |
| `toolArgTools` | [] | 一键行中渲染 key argument 的工具白名单 |
| `hideTools` | [] | 完全从 checkpoint 中隐藏的工具 |
| `includeReasoning` | false | checkpoint 中保留 reasoning 块 |

**行为测量**（示例）：在 cap=65,536 下编译后约 55,737 tokens，仅为 raw 的 **2.2%**，保留 325 个 entries，丢弃 1,876 个（超过 no-drop threshold 226,205 时）。

**恢复机制**：`recall` tool（type:"seq" / "result" / "checkpoint"）、`search` tool（grep durable log，返回 (seq N) 指针）、人类的 `/recall` 命令。maxRecallTokens 默认 16000、maxSearchHits 默认 50。

**安装方式**：① alias 替换内置 basic engine；② 直装并复制标准 preset、把 compaction engine row 换成它；③ 手动改 preset 配置文件。测试套件覆盖 compiler 单元、config 校验、session 集成、engine。

**设计哲学**：**instant（零延迟）、near-lossless（原始 token + 指针）、contract-exact（与 basic 的 seam 完全兼容）、可选 pruner 兼容**。它把"压缩"变成一次确定性的编译，把"丢失"变成一种可精确恢复的引用关系。


---

## 3. 社区插件：四条差异化路线

### 3.1 遗忘流派：pai-acp（earendil-works/pi，构建于 acp-kernel）

**一句话**：不是等到 context 满了才压，而是**给模型一把 `compress` 工具，让它自己判断何时、何地压缩成高保真摘要**，被压区间变成带标签的可解压块，多层蒸馏，关键字可搜。

**架构**（acp-kernel：host-agnostic 核心，零宿主依赖，MIT，23 模块、208 测试）：

- **消息级 invisible ref tag**：每条约束内消息被打上 `<acp m00001 ...>` 引用标签（对模型可见、对用户隐藏），模型用这些 ref 指定压缩区间。
- **8 阶段 pipeline（每 turn 执行）**：assign refs → sync blocks → merge blocks → prune → filter → hide compress calls → nudge-inject → emergency-truncate → render refs。
- **模型写入摘要**：核心**从不调用模型**；它只负责决定何时压、压哪个区间、跟踪 state（blocks/message-id mapping/tiers），应用压缩决策，支持 decompress/search。摘要内容由外部模型产出——"the model writes the summaries; this library orchestrates everything around them"。
- **三阶 LSM-tree 压缩**：活跃块 T1 → 堆积后蒸馏为 T2 → T3。每次 compress 成功会清空 growth baseline，防止重复 nudge。
- **Nudge 系统**：当 usage ≥ `minContextLimitPct`（默认 45%）触发 nudge；growth-gating 防止每 turn 重复 firing；tier-distillation triggers 在 T1 堆积时触发 T2 蒸馏；报告实际的 compressible ranges 供模型 targeting；emergency truncate 在 80% 强制压缩。
- **保护体系**：`compress` 调用本身 hard-protected（压缩它会破坏 decompress 与"摘要即历史"的契约）；软保护近期 zone（默认最近 5 条消息 / 最近 ~5K tokens，但 decompress/search_context/read/bash 的 tool result 除外——它们大且消费后理应可压）；用户最后一条消息恒保护。
- **工具集**：`compress` / `decompress` / `search_context`（无需解压即可搜块内信息）/ `acp_status` / `acp_delegate`（spawn clean-context 子 agent，5 种角色 reviewer/researcher/worker/planner/oracle）。
- **效果**：单会话可处理约 **10–60 billion cumulative tokens**；长期稳态上下文约 150K（opencode 版 <200K）；相比让上下文膨胀到百万级别的传统方案，单会话 token 成本约低 5×。

**哲学**：**把上下文管理责任转移给模型 + 用多阶结构化摘要 + 可搜索可解压的压缩块**，实现"同一个会话工作数月"。


### 3.2 验证流派：pi-smart-compact（alpertarhan/pi-smart-compact）

**一句话**：压缩不只是缩写，而是**对当前目标、决策、错误、未完成任务做一次验证式快照**——像一个留给自己的备忘录。

**EESV 流水线**：

1. **Extract（提取）**：确定性 catalog —— 文件、错误、决策、约束、话题、媒体元数据、open loops（verification ground truth）。
2. **Explore（探索）**：thorough 模式或 auto 选择；便宜模式用确定性边界。
3. **Synthesize（综合）**：自适应单遍或受限层次综合，带每 mode 预算（prompt/cap/token/output cap）。fast: 3 calls/100K prompt/20K out；balanced: 6/200K/40K；thorough: 8/300K/80K。
4. **Verify（验证）**：确定性修复到有界不动点，然后应用**确定性质量底线**；仅 thorough 模式可能在最终化前多花一次 LLM repair call。

**survive 清单**（压缩后必须活着的东西）：当前目标与用户约束；修改/读取/删除的文件；未解决与已解决错误史；显式与隐式决策；open follow-ups / blockers / priorities / pinned loops；下一步动作与关键延续上下文；距上一次压缩以来的变更；一份有界的 **Continuity Ledger**（携带 prior decisions/constraints/unresolved errors/open loops）。**目标措辞变更记为 context；事实只有通过证据或显式 override 才会退休。**

**验证护栏**：facts first；apply 前验证；zero-gap 确定性底线；高风险成功声明必须由主机结果或确定性证据 grounding；计划必须达到 mode target 且净节省 ≥ 10% 才能 finalization。

**可召回性**：**Smart Recall** —— verified scoped state 索引进 **SQLite FTS5 context graph**；跨项目会话用完整可见分支祖序召回；file relationship 单跳图召回。`smart_save_memory` 持久化单个用户确认的事实（最多 500 memories/project）。

**运行策略**：只 staging 经验证的 pending summary 供 Pi 下一次自然 compaction 使用，**绝不在 agent turn 中途压缩活跃对话**；zero-call deterministic path（提取置信度高时零 LLM 调用）；autoTriggerStrategy 可选 native-hook 或 settled（等待 agent_settled 再询问）。

**哲学**：**用确定性抽取建立 ground truth，用 LLM 只负责"综合与修复"，用验证作为 apply 的闸门**——压缩的可信度优先于压缩率。

### 3.3 入口拦截流派：Hypa（hypabolic/Hypa）

**一句话**：**最好的压缩是从来不让噪音进入上下文**。Hypa 不在上下文满了之后动手，而是在**工具输出刚要进入 context 之前就把它 deterministic 压缩掉**。

**工作机制**：
```
shell command → Hypa command runner → 命令特定的 reducer → 内置/可信 DSL filter → token 核算 → 返回 compact 输出
```
- **命令特定 reducer**：git / dotnet / kubectl / docker / cargo / gradle 等一等。
- **内置 declarative filters**：构建/测试、包管理、lint、云 CLI、系统工具等大量工具的白名单式过滤。
- **确定性、本地、可测试**：**默认不是 LLM summarizer**；用 `Microsoft.ML.Tokenizers` (o200k_base) 估算 token 节省。
- **tee artifact**：失败或截断时把完整输出 tee 到本地 artifact，compact 输出可保持很小但保留恢复访问。
- **SQLite 度量**：`~/.hypa/hypa.db` 存 sessions / command metrics / parse metrics / trust records；项目级可信过滤器需显式 `trust`。
- **节省报告**：`hypa filters savings` 生成覆盖率表格（例：dotnet-msbuild-noise 635→5 tok, −99%）。

**哲学**：把 Hypa 类比为**上下文窗口层的垃圾收集器**——在垃圾产生的地方就清理它，而不是等内存满了再回收。这是"不该进入就不让它进入"路线的工程典范。

### 3.4 Git 式会话管理：pi-context-tools + session tree

**pi-context-tools（theduke）**：两个工具——`context_info`（报告当前 context 用量、token 数、可用窗口详情）与 `compact_context`（触发当前会话压缩）。**让 agent 自我感知上下文状态并自行决定何时压缩**——特别适合 orchestration agent 协调子 agent 的场景。注意：keepRecentTokens 设得很小（如 500）时，压缩后报告的上下文大小会因系统提示/tool definitions/generated summary 而显得偏高，属预期行为。

Pi 原生还有 **Escape Esc 打开 session tree**：Navigate any historical node → Enter 从该点继续 → `/fork` 分叉。这是对"把上下文当 Git 管"理念的平台级支持。

### 3.5 近亲参考：DCP / Sleev（opencode-dynamic-context-pruning）

- **DCP**（Tarquinen / opencode，AGPL）：模型驱动，给模型 `compress` 工具支持 range 模式（连续区间）与 message 模式（逐条独立压缩，实验性）；**重叠压缩会嵌套**——早期摘要被嵌套进新摘要，信息多层保留不被稀释；dedup 重复 tool call（同工具同参数只留最新 output）；purge errors（错误输入在 4 轮后移除，错误信息保留）；保护工具列表（task/skill/todowrite/todoread/compress 等）。测得 prompt cache hit rate 从 90% 降到 85%，权衡取舍明确。
- **Sleev**（sleev.ai）：DCP 作者的新项目，context-management proxy（Claude Code / Codex / OpenCode），承继 DCP 核心思想并新增功能——可作为"主动遗忘派"的后续演进样本参考。


### 3.6 设计原型：pi-press（概念）

调研中**未发现名为 `pi-press` 的公开主流插件**（npm / pi.dev / GitHub 均无收录）。按其被描述的理念——"把压缩流程前置，上下文接近阈值时就提前生成摘要，真正需要 Compact 时可以直接切换，减少 Agent 因压缩产生的停顿"——可以把它理解为一条**设计原型 / 社区构想**，其思想已在以下实现中以不同程度落地：

- **OpenClaw（PI SDK）**的 proactive trigger：每 turn 后用 token 估算 + 安全边际主动检测 approaching limit（trigger 条件同 Pi 原生），`autoCompact=true`，溢出时用三级 fallback（compact → truncate oversized tool results → compact again），最多重试 3 次，最终仍溢出才报错并提示用户 `/compact`。
- **dsh-compaction-instant** 的"零延迟"：因为没有模型调用，"需要切换"本身就没有停顿，可视为 instant 版的无感切换。
- **ACP nudge + 预计算**：nudge 把压缩意图提前预告给模型，模型可以在"舒适"的位置（新任务边界、大结果提取后、大型重构前）调用 compress，从而避免 mid-turn 阻塞。

因此报告在后续设计中会将 **"pre-warmed / proactive pre-computation + idle-execution"** 作为一个明确的一级设计原则纳入。

---

## 4. 框架层实践

### 4.1 LangChain Deep Agents：模型自主触发 `/compact`

Deep Agents 把压缩做成**代理自己的一个工具**，而不是 harness 的硬规则：

- **动机**：固定阈值（85% 上下文限制）压缩是次优的——复杂重构中途不该压、新任务开始时才是好时机。把"何时压"的决策交给模型，让它自己判断 opportune times。
- **时机建议**（注入 system prompt）：cleanly task boundary（用户切换到新任务、deliverable 完成并被确认）；extracting result from large context（研究类）；consuming large new context 之前（要读大量文件或生成长 draft）；complex multi-step process 之前（plan 已出、即将执行长篇 refactor/migration/incident response）；decision supersedes prior context（新要求推翻旧上下文、大量死胡同可汇总）。
- **行为**：tool 参数与现有 summarization middleware 一致；保留最近 10% 的可用上下文，总结前面的内容；最近消息（含压缩调用本身及响应）保留。
- **调优保守**：custom eval + Terminal-bench-2（未观察到任何自主压缩触发，说明模型很克制）；实际 coding 任务中一旦触发通常确实改善了工作流。
- **兜底恢复**：所有历史保存在虚拟文件系统中，可事后恢复。

### 4.2 Claude Code / MCP context engineering

LangChain 的 context engineering 手册与 Anthropic 的 cookbook 归纳了四种手法：**write / select / compress / isolate**。Claude 生态强调两点工程现实：

- **Prompt caching 的权衡**：压缩会改变消息，从而 invalidate 从被改动 token 开始的前缀 cache。DCP 实测 cache hit rate 从 90% → 85%，但在长会话中 token 节省远超 cache miss 损失。
- **压缩工具链**：Anthropic 提供 `context_compression_v2` 等内置压缩中间件；MCP 也有 context engineering 工具集。

### 4.3 其他框架简述

- **CrewAI / AutoGen / Semantic Kernel**：主要依赖长程 memory 组件（SK 的 Memory、AutoGen 的 ChatManager + 子 agent 隔离），缺少原生的"压缩即替换"能力；多通过 RAG/selector 式的 Select 策略缓解。
- **OpenDevin**：使用自身 memory/compression 模块，走“读取大文件→提取关键片段”的 Select 路线，配合子进程沙箱隔离。
- **AgentMemory（rohitg00/agentmemory）**：跨引擎 persistent memory（SQLite+markdown），Layered memory + 事实持久化，可与任意 harness 共存。
- **vitos-pizza / pi-grounded-compaction 等**：利用打包好的 Hypa / grounding 摘要器作为底层压缩组件，体现"组合而非重复造轮子"的趋势。


---

## 5. 横向对比矩阵

| 方案 | 触发时机 | 是否用 LLM | 保真度 | 产物形态 | 可恢复性 | 额外能力 | 代表场景 |
|---|---|---|---|---|---|---|---|
| **Pi 原生** | 被动阈值（window−reserve） | 是（结构化摘要） | 有损（自由文本） | `<compacted-summary>` 单点替换 | 部分（firstKeptEntryId） | 分支总结、文件操作追踪 | 一般 Pi 用户默认 |
| **dsh-compaction-basic** | 被动阈值（tokenMeter pressure / overflow） | 是（结构化 checkpoint） | 有损 | `<compacted-summary>` 替换 | 弱（摘要内事实） | KV-cache 回放、structured 8-section、tool pruner | 追求摘要质量与缓存友好的 deep user |
| **dsh-compaction-instant** | 被动阈值 + manual | **否**（确定性 compiler） | **Near-lossless** | 原始 token + `(seq N)` 指针 | **强**（recall type:seq/result/checkpoint） | 逐块预算、tool result 指针化、grep 日志 | 极客、长 run、对可恢复性敏感 |
| **pai-acp / acp-kernel** | 模型决策（nudge 预告，model calls compress） | 是（模型写摘要） | 有损但多层蒸馏 | `<acp>` 标签 + T1→T2→T3 块 | 中（decompress / search_context） | 多阶压缩、sub-agent 委托、可搜索块 | 超长期会话（月级、GB 累计 token） |
| **pi-smart-compact** | 被动/半主动（auto 按压力选模式） | 是（验证式综合） | 有损但 fact-first | 结构化 verified state + Continuity Ledger | 中（SQLite FTS5 图召回） | EESV 验证管道、确定性 ground truth、零调用 | 可靠性优先的工程 agent |
| **Hypa** | **入口即拦截**（工具输出时） | **否**（确定性 reducer/filter） | 保留 error/path/exit-code（可 tee artifact） | 确定性缩减输出 + footer 标记 | 部分（artifacts/ 完整 tee） | 命令级 reducer、DSL filter、度量 | 命令行-heavy agent、reduce noise at source |
| **pi-context-tools** | 按需（agent 或人触发） | 否（委托主机 compaction） | 取决于主机 | — | 取决于主机 | agent 自感知（context_info） | orchestration agent 自我控制 |
| **DCP / Sleev** | 模型决策（nudge） | 是 | 有损 + nested 多层 | range / message 压缩块 | 中（decompress） | 重叠嵌套压缩、dedup、error purge | OpenCode 用户 |
| **Deep Agents** | 模型自主工具决策 | 是 | 有损 | 普通摘要 | 中（虚拟文件系统） | 保守调优、task-boundary 推荐 | Deep Agents SDK/CLI |
| **RAG 式 Select** | retrieval time | 否 | 无损（选子集） | top-k chunks | 无损（未删） | 嵌入召回、re-ranking | 知识库问答、长文档处理 |
| **pi-press**（原型） | **预计算+idle 执行+无感切换** | 视实现 | 视实现 | pre-warmed summary | 视实现 | 零阻塞切换 | 理想形态，未被单一定制包实现 |

**压缩效率测量示例**（dsh-instant，cap=65k）：编译后 55,737 tokens，约为 raw 的 **2.2%**；保留 325 entries，丢弃 1,876。

**理论/实证锚点**：生成博弈严格优于选择博弈；连续潜在向量在 4×压缩下 BLEU 超越全上下文 28.3%；视觉/文本压缩可降延迟 50%。


---

## 6. 更好方案的总体设计："Guardian-2" 分层上下文守护系统

基于上述调研，我提出一个融合各家最长板、规避各自短板的下一代设计。核心理念：

> **压缩只是最后防线；入口过滤与主动遗忘是主战场；记忆必须有层次、可验证、可回滚。**

### 6.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 5  Long-term memory（持久记忆层）                         │
│   • 跨会话事实图（SQLite/FTS5 + embedding）                     │
│   • 事实生命周期：诞生→确认→加权衰减→退休                       │
│   • 跨项目 continuity ledger                                   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4  Durable log + pointer index（近无损持久日志）         │
│   • append-only session log，每 entry 有序号 seq                 │
│   • checkpoint = 原始 token + (seq N) 指针                      │
│   • recall(type:seq|result|checkpoint)、grep                    │
│   • Git 式 branch/checkpoint/checkout 语义                       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3  Tiered summary index（分层摘要索引）                   │
│   • ACP-style T1→T2→T3 三阶蒸馏，按语义主题聚类                  │
│   • 压缩块双向索引：keyword(FTS5) + embedding(hybrid)            │
│   • 压缩块可 decompress，支持嵌套叠加                            │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2  Active tagging & extraction（主动标注与抽取）          │
│   • smart-compact 式 EESV：goals / decisions / files / errors   │
│     / open-loops / next-actions 结构化抽取                       │
│   • 每条消息的短标签（topic、decision-point、error、file-touch） │
│   • 抽取在后台 async 进行，不阻塞 turns                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1  Context window（工作上下文）                           │
│   • 最新 turn + 当前任务相关摘要 + pending items                │
│   • protected zones：用户最新输入、compress 元、未完成任务      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 0  Pre-entry filter（入口预过滤）                         │
│   • Hypa 式确定性 reducer（git/dotnet/kubectl…）                │
│   • dedup（同工具同参数→只留最新 output）                       │
│   • error input purge（错误调用的大输入在 N 轮后移除）           │
│   • token 预算内拒入/改写                                       │
└─────────────────────────────────────────────────────────────────┘
              ↑ orchestration policy 统一调度（见下）
```

### 6.2 编排策略：三层触发器 + 无感切换

**触发器 1 — 入口静态规则（Layer 0）**：始终开启，零成本、零模型，拦截噪音进上下文（Hypa）。

**触发器 2 — 生长门控 nudges（Layer 3/4，ACP 灵感）**：
- `minContextLimitPct`（~45%）时向模型注入 nudge（仅提示，不强制）；
- `emergencyThresholdPct`（~80%）时强制执行一次压缩；
- growth-gating：两次 nudge 之间要求正增长，避免每 turn 重复 firing；
- 压缩决策**只在 idle 或 turn boundary 执行**，never mid-turn；
- **pre-warm**：nudge 触发后立即在后台异步生成摘要，挂到索引；等到下一次 model request 时直接切换——实现"用户无感知、无停顿"（pi-press 原型理念的工程化）。

**触发器 3 — 模型自主工具（ACP/DCP/Deep Agents 灵感）**：模型可随时调用 `compress`，推荐时机：新任务边界、大结果提取后、要读大量新上下文前、复杂多步过程前、决策覆盖旧上下文时。

### 6.3 压缩质量保障

- **fact-first 验证（smart-compact 灵感）**：摘要生成后，用确定性抽取重算"survives 清单"，验证目标/文件/错误/决策/待办是否都在，缺口≤容忍阈值才 apply。
- **must-shrink 收敛（dsh 灵感）**：拒绝不缩小的压缩，否则回退到下一层（prune→摘要→截断）。
- **原子事务 + 可审计**：每次压缩写 lock/start/summary/end 事件日志，崩溃可检测孤儿锁，失败不污染 surface。
- **provenance & repair ledger**：记录每次压缩的来源区间、压缩比、验证缺口、修复动作——压缩也可"回滚"到最近 checkpoint。

### 6.4 记忆的生命周期（Agent 记忆的完整回答）

```
短期（working context）：最新 turn + 当前任务摘要 + pending items，TTL 以"任务生命周期"计。
中期（session memory）：三层摘要树 + 近无损指针日志，按 t1(7 天)/t2(30 天)/t3(永久归档但可搜) 衰减。
长期（persistent memory）：fact graph，跨会话继承，事实加权+时间衰减，用户显式 pin。
```

关键区分：**decisions / goals / requirements 长寿（事实级）；raw logs / intermediate outputs 短命（可丢弃）**。这与各方案的"保留什么"分歧直接对应。


### 6.5 伪代码骨架

```ts
// orchestration policy (runs at idle / turn boundary, NEVER mid-turn)
async function maybeCompact(ctx: AgentCtx): Promise<void> {
  // L0: pre-entry filter applies at tool-result write path (always on, no model)

  // L2: background extraction keeps the active tag set fresh
  extractActiveTags(ctx);  // EESV in background, non-blocking

  const pct = ctx.tokenMeter.usage();
  if (pct >= EMERGENCY_THRESHOLD) {              // emergency throttle
    await applyCompression(ctx, "forced");
    return;
  }
  if (pct >= MIN_NUDGE_PCT && grewSinceLastNudge(ctx)) {
    injectNudgeToModel(ctx);                     // hint only; model decides
    await prewarmSummary(ctx);                   // async pre-compute -> swap later
  }
}

async function applyCompression(ctx, mode) {
  // L0 prune first (deterministic)
  const afterPrune = await toolResultPruner.pruneSession(ctx.session);
  if (belowBudget(ctx)) return;

  // L3 build tiered summary of the selected span
  const summary = await buildTieredSummary(ctx);
  // L2 verify fact-first
  if (!verifySurvives(ctx.target, summary)) throw "quality floor violated";

  // L4 atomically replace span with summary + (seq refs), lock-broken-safe
  await ctx.compaction.compactNow({ mode, summary }, tx => commit(tx));
}

// recall: single API covering all layers
function recall(ctx, query) {
  const hits = hybridSearch(ctx.memoryGraph, query);   // FTS5 + embedding
  if (hits.seqRefs.length) return expandFromSeq(ctx, hits.seqRefs); // near-lossless
  if (hits.blockIds.length)  return decompressBlock(ctx, hits.blockIds);
  return summarizeRelatedSpan(ctx, hits.topics);
}
```

### 6.6 配置骨架

```yaml
guardian2:
  layer0_pre_filter: { enabled: true, reducers: ["git","dotnet","cargo",...] }
  layer2_active_tags: { models: { summary, segmentation, verification }, min_savings: 0.10 }
  layer3_tiers:
    t1_age_days: 7;   t2_age_days: 30;   t3_retain_forever: true
    search: { fts5: true, embedding: true }
  layer4_pointer_log: { checkpoint_cap_tokens: 65536, retain_seq_refs: true }
  orchestration:
    min_nudge_pct: 0.45;   emergency_pct: 0.80;
    prewarm_idle_workers: 2;   compress_at_turn_boundary_only: true
  memory_lifecycle:
    decision_retention: permanent;   raw_output_ttl_days: 3
    cross_session_ledger: true
```

### 6.7 与现有方案的映射（不是什么新玩具，而是工业级拼装）

| 需求 | 现有最佳组件 | 如何拼装 |
|---|---|---|
| 零延迟压缩 | dsh-compaction-instant | 取它的 deterministic compiler + seq pointer 机制 |
| 压缩决策权交给模型 | pai-acp / DCP / Deep Agents | 取它的 nudge + model-tool + 时机建议 |
| 结构化、可验证的快照 | pi-smart-compact | 取它的 EESV 抽取 + verify gate + continuity ledger |
| 噪音不进上下文 | Hypa | 取它的确定性 reducer + dedup + error purge |
| 多层蒸馏 + 可搜索 | acp-kernel | 取它的 T1→T2→T3 与 hybrid search |
| 事务安全 + 审计 | dsh-compaction seam | 取它的 lock/start/summary/end 事件 + must-shrink |
| 跨会话记忆 | agentmemory / context graph | 取它的 SQLite+FTS5 事实图 |


---

## 7. 关键洞察与趋势判断

1. **生成博弈优于选择博弈**（arXiv:2608.01326 的理论支撑）：摘要类方法天生比"丢旧留新"更高效、更保语义。单纯"遗忘流派"的剪枝如果缺乏结构化摘要与可搜索索引，长期会退化；最佳实践是"剪枝的骨架 + 摘要的血肉 + 指针的肌肉"三者合一。
2. **"不该进就不进" 胜过"进了再压"**：Hypa 代表的入口过滤与 dedup/error-purge 能以几乎零成本消灭最大头的 context bloat（tool logs、重复调用输出、构建噪音）。这是 ROI 最高的优化位。
3. **模型主导决策 > 框架硬规则**：被动阈值压缩总是在错的时间压（mid-refactor）、压错的内容；把何时压交给模型（ACP/DCP/Deep Agents）且在 idle/boundary 执行，既保留灵活性又消除阻塞。nudge 是完美的折中——预告而非强迫。
4. **无感压缩是终极体验目标**：pre-compute-in-idle + fast-compiler（instant）+ idle-swap 的组合能让用户完全意识不到压缩发生。dsh-instant 的零模型调用 + pre-warm 是实现这一点的两把钥匙。
5. **压缩的可信度是短板**：绝大多数方案有损且难验证。smart-compact 的 fact-first verify gate 指出了方向——压缩必须伴随"我保留了什么、还丢了什么"的可审计账本。
6. **记忆是跨会话的事实图，不是线性对话**：Pi 的文件追踪、agentmemory 的跨引擎 memory、smart 的 continuity ledger，共同指向——长期记忆应当脱离"某次会话"而存在，以事实/决策为单位带权重生效与衰减。
7. **Prompt cache 是压缩的真实隐性成本**：任何改动历史的操作都会 invalidate 前缀 cache；设计时必须把 cache 命中率和 token 节省一起建模（DCP 实测 85% vs 90% 就是代价）。

**一句话趋势**：下一代上下文管理系统 = **入口确定性过滤 × 模型自主调度 × 分层结构化摘要 × 近无损指针日志 × 可验证记忆图谱**，五者缺一不可；单一维度做到极致的方案（纯快、纯准、纯省）都无法独自胜任生产级长程 agent。

---

## 8. 参考资料

**论文**
- [arXiv:2608.01326] *Context Compaction Theory* — Context Selection Game / Generation Game，与 one-way communication complexity 等价，生成严格优于选择。
- [arXiv:2604.13725] *On the Effectiveness of Context Compression for Repository-Level Tasks* — 三种范式（离散 token / 连续潜在向量 / 视觉 token）实证；连续潜在向量 4×压缩下 BLEU 超全上下文 28.3%。

**官方平台**
- [Pi compaction docs](https://pi.dev/docs/latest/compaction) — auto-compaction、branch summarization、hooks、数据结构。
- [LangChain autonomous context compression](https://www.langchain.com/blog/autonomous-context-compression) — 模型自主 `/compact` 工具。
- [Claude context engineering](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)；[LangChain context_engineering repo](https://github.com/langchain-ai/context_engineering)。

**DeepSeek Harness 生态**
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — compaction 能力族目录。
- [packages/compaction README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/README.md)（seam + 事件契约）、[compaction-basic README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/compaction-basic/README.md)、[tool-result-pruner README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/compaction-tool-result-pruner/README.md)、[docs/subsystems/compaction.md](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/compaction.md)。
- [TsFreddie/dsh-compaction-instant](https://github.com/TsFreddie/dsh-compaction-instant)。

**社区插件**
- [pai-acp](https://pi.dev/packages/pai-acp) / [discussion #7414](https://github.com/earendil-works/pi/discussions/7414)。
- [ranxianglei/acp-kernel](https://github.com/ranxianglei/acp-kernel) — 三阶 LSM-tree、nudge、render strategies。
- [alpertarhan/pi-smart-compact](https://github.com/alpertarhan/pi-smart-compact) — EESV 验证流水线。
- [Hypabolic/Hypa](https://github.com/Hypabolic/Hypa)。
- [theduke/pi-context-tools](https://github.com/theduke/pi-context-tools)。
- [Tarquinen/opencode-dynamic-context-pruning](https://github.com/Tarquinen/opencode-dynamic-context-pruning)（DCP）、[sleev.ai](https://sleev.ai/)。

**设计与分析文章**
- [OpenClaw Part 5: Conversation Compaction](https://systemdesigner.medium.com/building-openclaw-from-scratch-part-5-conversation-compaction-c467e41f926f) — proactive trigger、五步管线、三级 overflow recovery。
- [明天的乌云：让 AI 主动管理自己的上下文](https://blog.xlab.app/p/51d26495/) — 主动遗忘 vs 被动压缩、session tree 与时间旅行式记忆。
- [Automatic Context Compression in LLM Agents](https://medium.com/the-ai-forum/automatic-context-compression-in-llm-agents-why-agents-need-to-forget-and-how-to-help-them-do-it-43bff14c341d)；[Redis context compaction guide](https://redis.io/blog/context-compaction/)。
