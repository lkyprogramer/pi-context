# Agent 上下文压缩：综合研究总结

> **说明**：本文基于已完成的深入调研整理而成，完整对照细节、配置参数与代码骨架见交付文档 `/outputs/上下文压缩综合调研报告.md`。本报告聚焦核心发现、机制对比与设计决策，可直接作为选型与设计依据。

---

## 一、先回答最根本的问题：Agent 记忆到底该是什么样？

所有压缩方案的差异，归根结底是对五个问题的不同立场：

| 问题 | 选项 | 主流方案的立场分布 |
|---|---|---|
| **谁决定压缩** | 框架硬规则 vs 模型自主决策 | Pi/Basic=框架；ACP/DCP/Smart/DeepAgents=模型工具 |
| **压缩的本质** | 选子集保留 vs 生成摘要 | 理论证明"生成"严格优于"选择" |
| **何时压缩** | 满了再压 vs 事前预防 vs 无感前置 | Hypa=入口拦截；ACP=nudge 预告；Instant=零延迟切换 |
| **代价** | 纯有损 vs 近无损可回滚 | Instant 用 `(seq N)` 指针；ACP 提供 `decompress` |
| **记忆结构** | 线性对话 vs 分层图谱 | Smart/agentmemory=持续 ledger+图；session tree/Git=分支回溯 |

**本文的核心判断**：下一代系统 = **入口确定性过滤 × 模型自主调度 × 分层结构化摘要 × 近无损指针日志 × 可验证记忆图谱**。单一极致的方案（纯快/纯准/纯省）无法独自胜任生产级长程 agent。

---

## 二、理论层：两条研究锚点

**1.《Context Compaction Theory》** [1] —— 首次形式化研究，提出两个博弈：
- **Context Selection Game**（从状态中选子集保留）——对应"剪枝/截断/丢旧留新"；
- **Context Generation Game**（把状态压缩成任意长度摘要）——对应 LLM checkpoint 类方法。

其定理：**生成博弈 ⇔ 单向通信复杂度**。这意味着通信复杂度的上界可直接迁移到上下文压缩，且**存在一组查询使"生成"的预算严格小于"选择"**——即摘要类方法理论上比简单丢弃更省空间、更保语义。

**2.《On the Effectiveness of Context Compression for Repository-Level Tasks》** [2] —— 三种范式实证（离散 token / 连续潜在向量 / 视觉 token）：
- **连续潜在向量**在 4×压缩下 BLEU 比全上下文高 up to 28.3%（它是在过滤噪声而非单纯截断）；
- 视觉与文本压缩在高压缩比下均可降低端到端延迟 up to 50%；
- 所有范式都降低推理成本。

**工程方法论**（LangChain context engineering）归纳四条路径：write（写时控质量）、select（RAG 式选子集）、compress（事后变密）、isolate（子 agent 隔离）[4][18]。

---

## 三、实现层深度对比

### 3.1 Pi 原生 compaction [3]

最简设计：`contextTokens > contextWindow − reserveTokens`（reserve 默认 16384）即触发，保留 keepRecentTokens 默认 20000 最新轮次。五步流程：倒推找切点（turn 边界感知，split-turn 时分段合并）→ 提取待汇总 → 结构化 LLM 摘要（超预算则分块→合并→层级叠加）→ 追加 `CompactionEntry` → 重建上下文。

亮点：`/tree` 导航自动做 branch summarization（离开工作流前写备忘录）；序列化时把 tool result 截断至 2000 字符控制预算；`session_before_compact` hook 允许扩展替换摘要。

局限：**纯框架阈值触发**（模型不决定时机）、自由文本摘要非结构化难检索、mid-turn 切割有风险。

### 3.2 dsh-compaction-basic [5][6][8]

把 compaction 拆成清晰的 capability seam：抽象契约（seam）+ provider（basic 后端）+ 模型免费 pruner 伴侣 + 人类命令消费者，任何 tokenizer/template 后端可插拔。

三个仅日志的 event 用事务锁保护（start→summary→end），保证崩溃可检测孤儿锁。后端核心机制：独占 `ctx.tokenMeter` 精确计量（含 system prompt/tools/schema/overflow buffer）；达标后先经可选 `toolResultPruner` head/tail 裁剪并重测，够了就跳过 summarization；KV-cache 友好的**回放式摘要调用**（原样重放对话前缀 + image 引用，只追加一条 instruction 进缓存热区）；结构化八段 checkpoint 指令并支持**合并旧 `<compacted-summary>` 区块**；对不收缩的摘要拒绝、溢出走三级 fallback 恢复。

### 3.3 dsh-compaction-instant（TsFreddie）[9]

basic 的**即插即用替代品**：确定性 conversation compiler（受 VCC 启发），零模型调用、毫秒完成、near-lossless。

- 输出只含原始 token，每次剪切打标记指向 durable `seq N`，被切内容可通过 `(seq N)` 从持久日志恢复——**真·无损**，不是有损摘要；
- Tool row 永远一行（≤128 tokens，永不重缩放），tool result 不再占 entry 改用 `-> result N` 指针；
- 逐块 budget（text/userText/toolCall）、checkpointCap 默认 65k、按序淘汰最旧 entry；
- recall(type:seq/result/checkpoint) + search(grep) 提供无损召回；
- cap=65k 实测：编译后 55,737 tokens ≈ raw 的 **2.2%**，保 325 entries、弃 1,876 条。

哲学：**instant（零延迟）+ near-lossless + contract-exact（与 basic seam 兼容）**。

### 3.4 pai-acp 与 acp-kernel 内核 [10][11]

"遗忘流派"的代表：给模型一把 `compress` 工具让它自己决定何时压什么，被压区间变成带 `<acp m000xx>` 引用标签的可解压块。acp-kernel 是 host-agnostic 核心（MIT、23 模块、208 测试），**核心本身从不调用模型**，只做 pipeline 编排、状态跟踪（blocks/ref mapping/tiers）和 compress 决策，摘要由外部模型产出。

八阶段 pipeline：assign refs → sync → merge → prune → filter → hide compress calls → nudge → emergency-truncate → render。三阶 LSM-tree 压缩（T1→T2→T3 蒸馏，堆积触发）；nudge 系统（minContextLimitPct≈45% 预告、growth-gating 防重复 firing、emergencyThresholdPct≈80% 强制）；保护体系（compress 调用自身 hard-protected、软保护最近 5 条/~5K tokens、用户最后一条恒保护）；配套 `search_context`（不解压即可搜块内）与 `acp_delegate`（clean-context 子 agent 委托）。

效果：单会话可处理约 **10–60 billion 累计 token**，稳态约 150K，比膨胀到百万级的传统方案省约 5×。

### 3.5 pi-smart-compact [12]

"验证流派"：压缩不是缩写，而是对当前目标/文件变更/错误/决策/待办做一次**验证式快照**（留给自己的备忘录）。EESV 流水线：Extract 确定性 catalog（目标、约束、文件、错误、决策、open loops）→ Explore → Synthesize 自适应综合（fast/balanced/thorough 三档预算）→ Verify 确定性修复到不动点 + 质量底线。必须 survive 的清单含目标与约束、读写删文件、未解决与已解决错误史、显式/隐式决策、pending loops、下一步动作，外加一份跨轮次的 Continuity Ledger。**事实只有通过证据或显式 override 才退休**。

Smart Recall 把 verified state 索引进 **SQLite FTS5 context graph** 实现跨会话召回。运行策略上绝不在 turn 中途压缩活跃对话，只 staging 已验证 summary 供下次自然 compaction 应用，置信度高时走 zero-call 确定性路径。哲学：**确定性的抽取建立 ground truth，LLM 只负责综合与修复，验证闸门在 apply 之前**——可信度优先于压缩率。

### 3.6 Hypa [13]

"入口拦截流派"：**最好的压缩是从一开始就不让垃圾进入上下文**。Hypa 在工具输出刚要进 context 时做确定性压缩——命令特定 reducer（git/dotnet/kubectl/docker…）、内置 DSL filter、token 核算、tee 完整 artifact 到本地 SQLite 以备恢复，默认**不是 LLM summarizer**。可看作"上下文窗口的垃圾收集器"：在噪音产生的地方就清理，ROI 最高。

### 3.7 pi-context-tools 与 session tree [14]

`context_info`（自我感知用量）+ `compact_context`（按需触发），让 agent 自己管理压缩时机，适合 orchestration 场景；Pi 原生的 Escape→session tree（任意节点跳转继续、`/fork`）是"把上下文当 Git 管"的平台级落地。

### 3.8 DCP / Sleev [15][16]

DCP（opencode，AGPL）与 ACP 思路接近但更轻量：range/message 双模式、重叠压缩会**嵌套**保留多层信息、dedup 同参数重复调用、error input purge（4 轮后清大输入留错误信息），实测 prompt cache hit 从 90% 降到 85%（明确权衡）；作者后续精力转向 Sleev——一个面向 Claude Code/Codex/OpenCode 的 context-management proxy，承继 DCP 思想并新增功能。

### 3.9 框架层：LangChain Deep Agents [4]

把压缩做成**模型自己的工具**而非 harness 硬规则，只在 model-recommended 时机（新任务边界、大结果提取后、即将读大量新内容/进入多步执行前、决策覆盖旧上下文时）才压，默认保最近 10%，调优非常保守。其他框架（CrewAI/AutoGen/Semantic Kernel/OpenDevin）多依赖 memory 组件与 select/RAG 策略缓解，缺原生"压缩即替换"能力；agentmemory [19] 提供跨引擎 persistent fact 图作补充。

---

## 四、横向对比矩阵

| 方案 | 触发时机 | 是否用 LLM | 保真度 | 产物 | 可恢复性 | 特色 |
|---|---|---|---|---|---|---|
| **Pi 原生** | 被动阈值 | 是 | 有损（自由文本） | `<compacted-summary>` | 部分 | 分支总结、文件追踪 |
| **dsh-basic** | 被动阈值/overflow | 是 | 有损 | structured 八段 checkpoint | 弱 | KV-cache 回放、tool pruner |
| **dsh-instant** | 被动阈值+手动 | **否** | **Near-lossless** | 原始 token+(seq N) | **强** | 零延迟、逐块预算、grep |
| **pai-acp** | 模型决策(nudge) | 是 | 有损+三层蒸馏 | T1→T2→T3 块 | 中 | 可搜索解压、子代理委托 |
| **smart** | 半主动 | 是 | 有损+fact-first | verified ledger | 中 | EESV 验证、FTS5 图召回 |
| **Hypa** | **入口即拦截** | **否** | 保留 error/path/exit | 确定性缩减输出 | 部分(artifact) | reducer/filter、度量 |
| **context-tools** | 按需 | 否（委托主机） | 取决于主机 | — | 取决于主机 | agent 自感知 |
| **DCP/Sleev** | 模型决策(nudge) | 是 | 有损+nested | range/message 块 | 中 | 嵌套压缩、dedup、purge |
| **Deep Agents** | 模型自主工具 | 是 | 有损 | 普通摘要 | 中 | 保守、task-boundary |

---

## 五、更好的方案：Guardian-2 分层上下文守护系统

综合各家最长板的实现方案，已在交付文档 §6 给出完整伪代码与配置骨架，核心如下：

```
Layer5 Long-term memory   → 跨会话事实图（SQLite/FTS5 + embedding），事实加权衰减
Layer4 Durable log        → append-only + seq 指针索引，Git 式 branch/checkpoint
Layer3 Tiered summaries   → T1→T2→T3 蒸馏，keyword(embedding 混合检索
Layer2 Active tagging     → EESV 背景抽取 goals/decisions/files/errors/open-loops
Layer1 Working context    → 最新 turn + pending items + protected zones
Layer0 Pre-entry filter   → Hypa reducer + dedup + error purge
```

编排采用**三层触发器**：Layer0 静态规则常开（零成本）；Layer3/4 nudge 门控（~45% 预告 → pre-warm 后台异步生成 → idle/surface-swap 无感切换，~80% 强制）；模型自主 `compress` 工具（推荐时机注入 system prompt）。质量保障：**must-shrink 收敛**（dsh 灵感）、**fact-first 验证闸门**（smart 灵感）、原子事务 + lock/start/summary/end 审计日志（dsh seam 灵感）、provenance & repair ledger 支持回滚。记忆生命周期：**目标/决策/需求长寿（事实级），原始日志/中间输出短命（3 天）**——这是"保留什么"分歧的解答。

一句话：**不该进就不进 > 让模型主动遗忘 > 满后再压**。pre-warm+zero-model 编译器是实现"用户无感知"的两把钥匙。

---

## 六、参考资料

[1] Context Compaction Theory. https://arxiv.org/abs/2608.01326
[2] On the Effectiveness of Context Compression for Repository-Level Tasks. https://arxiv.org/abs/2604.13725
[3] Compaction documentation (Pi). https://pi.dev/docs/latest/compaction
[4] Autonomous context compression (LangChain blog). https://www.langchain.com/blog/autonomous-context-compression
[5] packages/compaction README (deepseek-harness). https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/README.md
[6] compaction-basic README (deepseek-harness). https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/compaction-basic/README.md
[7] compaction-tool-result-pruner README (deepseek-harness). https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/compaction/compaction-tool-result-pruner/README.md
[8] docs/subsystems/compaction.md (deepseek-harness). https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/subsystems/compaction.md
[9] dsh-compaction-instant (TsFreddie). https://github.com/TsFreddie/dsh-compaction-instant
[10] pai-acp package (Pi). https://pi.dev/packages/pai-acp
[11] acp-kernel repository. https://github.com/ranxianglei/acp-kernel
[12] pi-smart-compact repository. https://github.com/alpertarhan/pi-smart-compact
[13] hypabolic/Hypa repository. https://github.com/Hypabolic/Hypa
[14] theduke/pi-context-tools repository. https://github.com/theduke/pi-context-tools
[15] opencode-dynamic-context-pruning (DCP). https://github.com/Tarquinen/opencode-dynamic-context-pruning
[16] sleev.ai. https://sleev.ai/
[17] Building Openclaw, part 5: Conversation compaction. https://systemdesigner.medium.com/building-openclaw-from-scratch-part-5-conversation-compaction-c467e41f926f
[18] LangChain context_engineering repository. https://github.com/langchain-ai/context_engineering
[19] agentmemory persistent memory. https://github.com/rohitg00/agentmemory