# DSH Context Runtime（DCR）Greenfield 规格 v1.0.0 深度评审报告

> 评审日期：2026-08-26
> 评审对象：`dsh-context-runtime-greenfield-spec-v1.0.0`（43 编号文档 / 16 ADR / 12 DSH RFC / 38 TDD 任务 / 16 JSON Schema / 202 文件）
> 参照基线：deepseek-harness `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh@0.1.1-rc.2`）
> 评审性质：文档级架构/技术/可实现性评审 + 源码交叉核验 + 外部研究对照。所有评分均为评审判断；已执行与未执行的验证在 §2 中明确区分。

---

## 0. 评审结论（TL;DR）

**总体判断：Go with conditions（有条件推进）。**

这是评审者所见过的同类设计文档中**完成度和严谨度最高的一份**：抽象方向正确（从"永久替换式 compaction"升级为"请求时上下文运行时"），研究基础真实（7 个 arXiv 引用逐一核验全部存在且标题吻合），对上一版评审（`DSH-Context-Compaction-Deep-Review`）提出的 10 条 P0 改造建议**吸收了 9.5 条**，DSH 基线 commit 与源码事实精确匹配，包自带的离线验证脚本实测通过（PASS 1946 checks，manifest 全 OK）。

但存在四个必须在实施前解决的问题：

1. **P0 — Prompt cache 经济学未闭环**：请求布局把易变 section（continuity/directory）放在最大稳定 section（recent tail）之前，结构性破坏前缀缓存；DeepSeek 缓存命中价差约 10–50×，命中率坍塌足以吞掉全部 "35% token 节省" 目标甚至倒赔。规格有意识（`cache_rewrite_cost`、receipt first-different section）但没有布局约束、没有命中率 SLO、没有发布门。
2. **P0 — "确定性抽取用户约束"的能力边界被高估**：由于 DCR 每请求只发送工作集（不再全量发送 surface），claim 抽取漏检是**系统性、不可自愈**的信息丢失，比旧 compaction 模式更脆弱。需要"用户消息全文保留"兜底策略。
3. **P0 — DSH 上游改造量级被低估**：源码核验证实 materialize 插入点需要**倒置现有控制流**（messages 派生目前先于 provider/model 解析），且上游在 compaction 接缝设计时有书面记录明确拒绝过类似位置的方案；R01（上游拒绝）概率应上调，fork-first 策略应从 fallback 提升为默认预期。
4. **P1 — 实现级规格存在系统性内部漂移**：同名接口两套字段（12 章 vs 22 章）、`bodyHash` vs `outputHash`、TS 与 JSON Schema 枚举不一致、数据目录两种口径（workspace vs DSH_HOME，两者隔离语义完全不同）、包布局三种口径。对一份自称 "Agent 可直接执行" 的规格，这类漂移会直接产生互相矛盾的实现。

评分（10 分制，对齐上一版评审的维度以便对比）：

| 维度 | 上一版（adaptive 设计） | 本版（DCR greenfield） | 说明 |
|---|---:|---:|---|
| 架构方向 | 8 | **9** | 请求时物化 + 单一 Context Owner 是正确的抽象跃迁 |
| DSH 兼容性/集成设计 | 9 | **7** | 接缝设计更干净，但侵入量级更大、上游风险更高 |
| 安全与故障不变量 | 8 | **9** | authority lattice + outcome attestation + crash matrix 超出全部对照项目 |
| 记忆保真度设计 | 6 | **8** | claim-level/bitemporal/polarity 到位；抽取召回边界是残余短板 |
| 长期有界性 | 5 | **8** | prompt-external catalog + 硬预算 directory 解决了 frozen index 增长 |
| 成本模型 | 6 | **6** | net value 公式完整，但 cache 经济学未闭环、无量化门 |
| 实证成熟度 | 4 | **4** | benchmark 仍是规格而非结果（greenfield 属性，非缺陷，但保持清醒） |
| 规格实现就绪度 | 6 | **7** | 任务/计划/schema 完备，但内部漂移和算法细节缺口拉低 |

---

## 1. 评审方法与证据基础

### 1.1 已实际执行并观察到结果

- 通读规格核心 30+ 篇文档（00–19、21–31、34–36、38–39、42、VALIDATION、BUILD-INFO），抽样 16 项 Schema 中的关键 4 项、tasks（T04/T30）、plans（00/04）、dsh-rfc reference 全部 6 件、ADR 抽样。
- **实际运行** `python3 scripts/validate_artifacts.py`：`PASS: 1946 checks / files: 202`；`shasum -a 256 -c MANIFEST.sha256`：全部 OK。
- 派发只读子代理核验 deepseek-harness 源码（HEAD、版本、agent-loop/tool-calls/session/token-meter/compaction 生态逐文件核对，file:line 证据见 §5）与 dsh-compaction-instant（35 测试实际运行：29 pass / 6 fail，失败均为未安装 peer 依赖的 `ERR_MODULE_NOT_FOUND`，非逻辑失败）。
- 派发网络调研子代理：逐一 WebFetch 核验规格锁定的 7 个 arXiv 编号（§7.1）；抓取 billion-context-pi / billion-context-dsh / pi-mono compaction 文档 / Anthropic·OpenAI·DeepSeek 缓存定价原文（§7.2–7.3）。
- 派发子代理完整消化四份用户参考报告，输出机制级摘要与矛盾清单（§8）。

### 1.2 未执行/无法执行

- 未运行任何 DCR 实现代码（不存在，greenfield）。
- 未对 DSH 实际打 patch 验证 6 个 PR 的编译可行性（属实施期工作；本评审以源码结构推演）。
- 未复现任何论文/社区项目的效果数字；所有第三方数字按"项目自报/论文自报"处理。

---

## 2. 项目定位与核心理解（评审者复述，供校准）

DCR 不是新的摘要后端，而是把 DSH 的上下文管理从"**持久 Surface 替换**"（选区间 → 生成 checkpoint → 永久替换）升级为"**请求时物化**"：

- 完整历史与工具原文保留在 prompt 之外（append-only session log + 加密 CAS blob + SQLite）；
- 工具结果写入 session 前经 `projectObservation()` 完成原文留存、来源绑定、确定性降噪；
- 以带证据/极性/时间/权限/生命周期的 Claim Ledger + Continuity Ledger 取代自然语言摘要；
- 每次模型请求前 `materialize()` 按 `I_eff` 预算装配 request-local 工作集，产生可重放 receipt，**不修改 Surface**；
- 检索 exact-first（ID → literal → FTS5/BM25 → 可选 semantic 候选 → exact evidence read），purpose-bound lease 管理注入生命周期；
- LLM 只做后台候选（prepared → verify → CAS publish），确定性路径永远可用。

DSH 核心只新增一个必选 Service（`ctx.contextRuntime`，两方法）+ pass-through provider + 三类 log-only 事件 + Token Meter v2。

这一定位在评审者看来是**成立且先进的**——它把上一版评审指出的所有结构性缺陷（entity grounding、frozen index 增长、单一 state、一回合 lease、K=4 成本模型）从根上消除，而不是打补丁。

---

## 3. 底层架构设计评估

### 3.1 突出优点

1. **Canonical/Serving 双平面分离**（04 章）：serving 索引可删可重建、canonical 单写事务 + CAS head，是教科书级的 event-sourcing 应用；`ContextHead = hash(六个分量)` 让 stale 检测变成纯比较问题。
2. **单一 Context Owner**（21/22 章）：`projectObservation` 管写入口、`materialize` 管读出口，同一 provider 拥有"什么进入模型"的唯一所有权，根除了旧体系"两个插件互相重写消息"的顺序/权限/诊断冲突。Loader 校验 composition 恰好一个 owner（28 章）是正确的强制手段。
3. **Authority lattice + non-escalation**（09 章）：`none < inform < propose < act`，派生对象取 min(sources, transformer ceiling)，assistant 自述只能是 proposal，outcome 必须工具/回执 attest——这套模型超过了所有被对照的业界项目（含 Anthropic 官方实践），且有对应 mutation test 要求（32 §8）兜底。
4. **失败语义完备**：crash matrix（17 §2）覆盖 ingress/generation/materialization 全部中间态；overflow recovery 用 "output hash 改变 + token 严格减少" 做进度证明，替代旧的 surface replacement 证明——这是一个漂亮的不变量替换。
5. **Kill criteria**（42 章）：明确列出"确定性路径无收益就停"等止损条件，在这种野心规模的设计里是罕见且健康的。

### 3.2 架构层问题

**A1（P0）：请求布局与前缀缓存的结构性冲突。**
04 §3 规定的布局是 `[system][tools][preamble][seed+hard][continuity][directory][recent tail][leases]`。continuity 在每次 claim transition 后变化，directory 的 top-k 排序公式（11 §6）显式包含 `novelty` 与 `repeatedInjectionPenalty` 两个**按请求变化**的项——即 directory 被设计为每请求可变。这两个 section 位于 recent tail（预算占比最大的 32%）之前，意味着几乎每次请求都从 continuity 处开始缓存失配。

证据链：
- Manus 工程博客：KV-cache 命中率是生产 agent 最重要单一指标，缓存/非缓存价差 10×，前缀一个 token 变化即失效其后全部。
- DeepSeek 定价：V4 Flash 命中 $0.0028/M vs 未命中 $0.14/M（50×）；V4 Pro 命中 $0.003625/M vs 未命中 $0.435/M（120×）。DCR 的默认目标 provider 恰是缓存价差最大的一家。
- pi-mono 官方 compaction 对一次性摘要请求**主动关闭缓存写**——同行已把"重组类请求的缓存行为"当作显式设计项。
- 规格自身：13 §1 承认容量与费用分离，13 §4 net value 含 `cache_rewrite_cost`，24 §7 要求 `[system][stable tools][hard commitments][stable continuity prefix]` 逐字稳定并在 receipt 记录 first-different section。

结论：规格**有意识但未闭环**。24 §7 的"stable continuity prefix"与 04 §3 的动态 continuity 渲染、11 §6 的动态 directory 排序之间没有协调机制；全文没有缓存命中率的 SLO、benchmark 指标（33 §5 只有 cumulative cache 一项记账）或发布门。若 35% token 节省伴随命中率从 90% 跌至 10%，在 DeepSeek 定价下总输入成本可能上升数倍——恰好触发 01 §4 "每成功任务总成本不高于最佳简单基线" 的失败，但到 benchmark 阶段才发现就太晚了。

**建议**（详见 §9.1）：把布局改为"稳定前缀区 + 追加区 + 易变尾部区"三段式；directory/lease/gap-retrieval 全部移到 recent tail 之后；continuity 拆分为 stable prefix（按 generation 变化）+ delta 尾部；把 `cache_hit_ratio` 列入 34 章发布门与 33 章 benchmark 主指标；在 22 章 receipt 中已有的 first-different section 基础上加 per-request cache 遥测。

**A2（P0）：确定性抽取的能力边界。**
08 §5 把 "user constraints and corrections" 列入确定性抽取清单。从自由文本可靠识别约束、更正及其作用域是语义任务，确定性 parser 只能覆盖显式模式（如命令式句、结构化标记）。关键在于失败模式的严重度变了：

- 旧 compaction 模式：抽取漏检 → 压缩时丢失，但压缩前模型看过全文，且用户消息通常被保留策略偏袒；
- DCR 模式：**每次请求只发送工作集**。一条三十轮前的用户约束若未成为 claim、未进 directory top-k、未触发 gap detector（11 §5 的触发条件全部要求显式信号：已知 ID/path/error 被提及、missing-context code 等），模型将永远看不到它。漏检从"单点损失"变成"结构性缺席"。

规格对此的对冲（recent tail 保留近期原文、hard pin、R05 风险条目、行为级 benchmark）都是事后检测，不是机制性保证。四份参考报告中报告 4 §8.9 提出的"每个新顶层 user turn 前构造轻量 recall query"未被吸收（11 §5 的 gap detector 触发面明显更窄）。

**建议**：增加一条硬不变量——**authenticated user 消息原文默认全保留**（作为 catalog 中永不降级的可寻址层，且在 directory 中按近因保底展示），直到被显式 supersede；把 gap detector 扩展为每 user-turn 的轻量主动召回；在 33 章 benchmark 增加 "constraint recall @ N turns" 分项指标。

**A3（P1）：野心规模 vs 上一版评审的收敛建议。**
上一版评审（报告 3）的第 10 条 P0 是"降低首发事务复杂度，先证明 M1 再加层"。DCR 的回应是双重的：一方面**语义上更简单**（彻底取消 surface replacement，多区域 checkpoint 问题不复存在）；另一方面**系统上更大**（加密 CAS + HKDF + keychain + FTS5 + bitemporal claims + lease + verifier + 后台 CAS + shadow eval + client UI，38 任务 6 个上游 PR）。W0–W1（deterministic Alpha）事实上就是一个完整的中型数据库系统。分波计划和 kill criteria 是合理对冲，但评审者提醒：**Phase 1 Alpha 的真实工程量约等于 dsh-compaction-instant 全项目的 5–8 倍**，而其价值验证（"无 semantic 也能长期维持有界上下文"）要到 W3 结束才可观测。建议在 W1 结束处增加一个中间验证点：仅用 observation ingress + exact recall（即 Hypa + instant 等价物）对比基线跑一轮 smoke benchmark，尽早取得净值信号。

---

## 4. 技术设计评估（分模块）

| 模块 | 评价 | 要点 |
|---|---|---|
| 存储引擎（07） | 优 | 单写 worker、WAL、spool→CAS→descriptor 提交序列、orphan GC、fail-closed ready 均正确。注意 §6.2 的路径口径矛盾（见 C4） |
| 入口/Reducer（08/23/25） | 优 | reducer 按 registration/hash 路由、禁网络/shell/模型调用、失败策略矩阵清晰。`use-original` 对 integrity/authority 错误禁用（25 §5）是关键细节，防绕过诱导 |
| Claim/Authority（09） | 优 | 完整；"语义 entailment 不能完全由代码证明"的坦白（09 §4）值得肯定，但正是 A2 问题的根源 |
| Continuity（10） | 优 | LEDGER_OVERFLOW fail-closed、错误五阶段生命周期、外部副作用一等对象均到位 |
| 检索/Lease（11） | 良 | 排序公式合理但引入了缓存问题（A1）；gap detector 触发面偏窄（A2）；无任意 regex 是正确的 DoS 防线 |
| 物化（12/13） | 良 | 算法 16 步完整、reduction 顺序确定、UNREPAIRABLE_ENVELOPE 语义清晰。view blob 全量落盘的增长问题见 C7 |
| Consolidation/Verifier（14/15） | 优 | 12 级 verifier、无 summary-of-summary、prepared/committed CAS、fencing key 维度完整（含 tokenizer/schema/config/workspace hash——报告 3 P0-8 全部命中） |
| 安全（16/35） | 优 | 威胁列表覆盖 poisoning/laundering/corroboration/egress chain；"数据标签只是风险降低，真正边界是 authority propagation + action gate" 的分层表述准确诚实 |
| 故障恢复（17） | 优 | 错误码表 + crash matrix + 降级模式完备 |
| 配置（19） | 良 | 跨字段不变量明确；`observationFailurePolicy: fail-open` 作为 balanced 默认与不变量 1（raw 先于 reducer 持久化）之间的关系应在文档中显式说明（fail-open bypass 时该不变量被豁免） |
| 测试/评测（32/33） | 优 | mutation test 指定必删 guard 清单、golden trace 禁自动刷新、boundary-local paired continuation 吸收了 TRACE 方法论 |
| 发布门（34） | 优 | Critical/High 不可 waiver；缺缓存命中率门（A1） |

---

## 5. DSH 集成可实现性（源码交叉核验结果）

以下结论来自对 deepseek-harness HEAD（= 规格基线 commit，精确匹配，`git merge-base` 与 tag `dsh-v0.1.1-rc.2` 双重确认）的逐文件核验。

### 5.1 核验通过项

- **基线声明准确**：commit、版本号、包版本全部吻合。
- **`projectObservation` 插入点成立**：`tool-calls.ts` 的 `commitReady()`（146–160 行）→ `appendToolResult()`（268–289 行）确实是"finalize 后、写入前"的干净单点；23 章引用的原代码段与实际源码一致。
- **事件模型假设成立**：session append-only、`SurfaceOp` 仅 `append`/`replace`、surface 三事件类型编译期强制、`assertProvenance` 强制 replace 引用完整——27 章新事件设计与现有不变量兼容。
- **compaction 生态描述属实**：compaction-basic（`agent/pre-step` + `agent/request-error` 双钩子）、tool-result-pruner（事后 surface 重写）、command-compact 均存在，行为与规格 21 §6 的描述一致。

### 5.2 核验发现的问题

**C1（P0）：materialize 时序需要倒置现有控制流。**
`agent.ts:339-342` 中 `session.deriveMessages()` 作为 `buildRequest()` 的实参**同步求值**，先于 `buildRequest` 内部的 `agent/request` waterfall + `ctx.llm.prepareCall()`（457–474 行）——即当前"messages 派生"先于"provider/model 最终确定"，与 DCR 要求的顺序相反。规格 24 §1 **明确承认**这一点并给出 `buildRequest` 六步拆解方案，所以这不是规格错误；但源码证实这是**改变控制流的架构级重构**，不是"插一个钩子"。风险在于：

- 上游设计记录 `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md` 显示，compaction 接缝设计时**明确拒绝**过"在 `agent/request` 上做 compaction"和"专用 loop 回调"两种备选——即上游对在请求构造路径上加扩展点有过负面立场；
- Token Meter v2（PR-4）会影响 compaction-basic、pruner 以及第三方 dsh-compaction-instant（三者均注入 `tokenMeter`）。

**建议**：29 章 RFC 应直接引用并回应该 Agent Note 的历史决策理由（说明 materialize 与当年被拒的 request-hook 的本质差异：全量所有权 + receipt + pass-through 等价，而非又一个 waterfall 消费者）；R01 概率从"中"上调为"中高"；把 §29.6 的 fork fallback 从"备选"改为"默认并行轨道"。

**C2（P1）：`appendSkippedToolCall` 平行路径未覆盖。**
`tool-calls.ts:249-259` 在 abort 场景为未执行的调用追加合成 abort 结果，不经过 `commitReady()`。23/25 章的投影链路只覆盖正常提交路径。需要明确：合成结果是否需要（跳过投影的）observation receipt，以保持 27 §3 replay 校验规则（"tool result 引用的 observation 存在"）的一致性——否则 replay validator 会对合成结果报错或需要豁免规则。规格未写。

**C3（P2）：与 `ToolResultPruner` 服务的关系未讲清。**
现有 pruner 是"事后 surface 重写"模型，DCR 是"写入前投影"。28 章禁用了 pruner 行，但 dsh-compaction-instant 这类第三方通过 `ctx.get('toolResultPruner')` 可选协作的模式说明该服务有独立消费者。建议在 21 §6 增加一段：DCR profile 下 `toolResultPruner` service 本身是否仍注册（还是仅 disabled 其自动行为），第三方引用它时的行为是什么。

**C4（P1）：生态兼容细节——prerelease semver 陷阱。**
dsh-compaction-instant 的 peerDependencies `^0.1.0-rc.6` 按严格 semver 不匹配 `0.1.1-rc.2`（prerelease 范围只在同 [major.minor.patch] 元组内生效）。DCR 的 peer dependency 策略（21 §7 "能力版本通过 package peer dependency 明确约束"）应显式规定 prerelease 期的匹配写法（如 `>=0.2.0-0 <0.3.0`），避免重蹈覆辙。

---

## 6. 规格内部一致性问题（实现级硬伤清单）

这些漂移对普通设计文档是小事，但本包自我定位为"Agent 可独立执行的实现级规格"（tasks/README），漂移会直接产生互相矛盾的实现。validator 只校验结构/schema-example 对应，**查不出跨文档 TS/散文漂移**（已实测：validator PASS 但以下问题全部存在）。

| # | 位置 | 问题 | 严重度 |
|---|---|---|---|
| D1 | 12 §1 vs 22 §1 | 两个同名 `ContextMaterializationInput`：12 章 `trigger: normal/soft-pressure/manual/overflow/resume` + `surfaceMessages` + `tokenizerRevision`；22 章 `reason: normal/retry/context-overflow/manual-preview` + `canonicalMessages` + `snapshot`。schema 采用 22 章口径。若是"DSH seam 输入 vs DCR 内部输入"的分层，必须改名（如 `RuntimeMaterializationPlan`）并写明映射 | P1 |
| D2 | 06/07/12 vs 22/24/26/27 | `bodyHash`（06 §10、07 表、12 §5）与 `outputHash`（22/24/26/27）指同一概念，两名并用且 26 §8 的 overflow 证明只引用 `outputHash` | P1 |
| D3 | 22 §1 vs `materialized-context.schema.json` | TS receipt 无 `capabilityVersion` 字段，schema 列为 required；TS section authority 枚举 5 值，schema 7 值（多 `untrusted-user`/`external-content`） | P1 |
| D4 | 07 §1 vs 19 §2/31 §1 | 数据目录 `<workspace>/.dsh/context-runtime/` vs `${DSH_HOME}/context-runtime/`。两者不只是路径差：31 §2 "多会话共享一个 DB，按 workspace/session scope 隔离" 隐含全局 DB，07 章隐含 per-workspace DB——隔离边界、跨 workspace 检索为零的安全声明（01 §5）、备份/GC 策略都随之不同。必须裁决 | **P0.5** |
| D5 | 05 §1 vs 30 §1 vs tasks | 包布局三种口径：05 章 15 个细粒度包（kernel/storage-sqlite/blob-cas/...）；30 章 6 个包（contracts/engine/worker/dsh-adapter/testkit）；T30 引用 `packages/engine/`、`packages/dsh-adapter/`。任务与 30 章一致，05 章是孤本 | P1 |
| D6 | 05 §4 vs 21 §2/29 PR-1 | DSH fork 目录：05 章列 `context-runtime-direct/observation-ingress/observation-ingress-direct/command-context`（暗示两个分离 service）；21/29 章是 `context-runtime` + `context-runtime-pass-through` 两包单 service。05 §4 疑为早期草稿残留 | P1 |
| D7 | 26 §5 vs 29 PR-4 | 旧 `measure()` API："保留一个发布周期并标 deprecated" vs "在 DSH 0.2.0 以 v2 取代，不保留 deprecated bridge" | P2 |
| D8 | 13 §1 vs 26 §3 | `I_eff` 公式第三项 `providerOverhead` vs `providerReservedTokens` | P2 |
| D9 | plans/*.md | 引用外部技能 `superpowers:subagent-driven-development`——包外工具假设，执行环境不保证存在 | P2 |

**建议**：修复后在 validator 中增加两类检查——(a) 跨文档同名 TS 接口的字段一致性（从 fenced code block 提取 interface 做 diff）；(b) 术语单一性表（bodyHash/outputHash 这类别名清单）。

---

## 7. 外部研究对照

### 7.1 引用核验（全部通过）

规格 02 §5 锁定的 7 个 arXiv 编号经逐一 WebFetch 核验，**全部存在且标题/主题吻合**：

| 编号 | 实际论文 | 吻合 |
|---|---|---|
| 2608.01326 | Context Compaction Theory（Tirmazi et al., 2026-08） | ✅ 逐字 |
| 2608.06503 | Toward Reliable Context Compression…（TRACE 为文中框架名，boundary-local paired continuation 机制吻合） | ✅ |
| 2606.23525 | Self-Compacting Language Model Agents | ✅ 逐字 |
| 2605.20833 | MemGym: a Long-Horizon Memory Environment for LLM Agents | ✅ |
| 2505.23662 | ToolHaystack | ✅ |
| 2510.00615 | ACON: Optimizing Context Compression for Long-horizon LLM Agents | ✅ |
| 2410.10813 | LongMemEval | ✅ |

未发现虚构引用、编号错配。规格同时避开了参考报告中的两个命名陷阱：未引用无法核验的 "pi-press"，且使用了 `billion-context/acp-kernel` 新名而非旧名 pai-acp（39 §3）。

### 7.2 pi 项目对照（用户指定的 `ranxianglei/billion-context-pi`）

该仓库真实存在（112 stars，npm 发布，MIT；内核 acp-kernel 独立仓库、208 测试、零运行时依赖），另有直接移植到 DeepSeek Harness 的 `Tyan66666/billion-context-dsh`（48 stars，Beta）——后者才是 DCR 事实上的**同场景直接竞品**。机制对照：

| 维度 | billion-context-pi/dsh | DCR |
|---|---|---|
| 压缩决策权 | **LLM 为主**（compress 工具 + nudge 软建议），80% 才确定性兜底 | **确定性为主**，LLM 只做后台候选且需 verifier |
| 原文保留 | append-only log 本身为真源，decompress/search_context 回读 | 加密 CAS blob + SQLite，exact read 校验 hash |
| 历史处置 | 压缩块替换进上下文（可逆） | 永不替换，每请求重新物化 |
| 检索 | stemming + CJK bigram + fuzzy | exact-first + FTS5/BM25，禁 embedding 于正确性路径 |
| 验证 | 无行为级验证 | 12 级 verifier + boundary-local continuation |

两条路线的本质分歧是**决策权方向相反**。DCR 的选择有据可依：MemTool 实测"模型自主管理上下文"的效率强依赖模型能力（推理模型 90%+ vs 中等模型 0–60%）；Self-Compacting 论文证实"仅给工具不够，需要 rubric"；ACE 证实反复 LLM 重写导致 context collapse。**对以 DeepSeek 系模型为默认目标的 harness，确定性优先是更稳健的选择**——建议把这条论证明确写进 02 章（目前规格只陈述立场，未引用这组反方证据）。

注意：billion-context-pi 自报的 "10–60 billion 累计 token / 5× 省钱" 为模拟测试自述，无第三方复现，规格未引用（正确）。

### 7.3 关键设计点的先例地图

- **结构化台账代替摘要**（Claim Ledger）：HippoRAG（增量图谱不重写）、Graphiti（time-stamped facts + supersession）、CoALA（分类框架）——**先例最扎实的一条**。
- **确定性优先 + LLM 候选 + 行为验证**：Slipstream（trajectory-grounded compaction validation，与 15 §4 shadow continuation 几乎同构）、ACE（context collapse 定量证据）、Aider repo map（确定性选择先例）——有分散但方向一致的支撑。
- **exact-first 检索**：BM25 在报错字符串/标识符精确匹配上优于向量检索是多来源共识；LangGraph/LlamaIndex 默认向量路线针对的是语义泛化场景，与 coding agent 需求不同——立场站得住。
- **永不替换、每请求物化**：**调研范围内无生产级先例**。pi 官方、Claude Code、OpenAI truncation 全是替换/截断路线；Context-Folding（ICLR 2026）最接近但仍是替换式。这是 DCR 最激进的一点：没有可借鉴的工程代价数据，A1（缓存）正是这种无人区里最先撞上的暗礁。风险评估应按"首创"而非"集成已验证实践"来做。

---

## 8. 对四份参考报告的吸收度核对

### 8.1 上一版评审（报告 3）10 条 P0 → DCR 回应

| P0 | DCR 回应 | 判定 |
|---|---|---|
| 统一 I_eff 口径 | 13 §1 + 26 §3（存在 D8 命名漂移） | ✅ |
| 预算×阶段触发 | 13 §2 五阶段 + maxDeferral | ✅ |
| claim-level evidence（polarity/时间/supersession） | 06/09 章完整 | ✅ |
| Continuity Ledger | 10 章完整（task fronts 四态、错误五阶段） | ✅ |
| frozen index 硬边界 | prompt-external catalog + 8% directory 硬顶 | ✅ |
| 分级召回 + purpose-bound lease | 11 章完整 | ✅ |
| Hypa 式 ingress 首发主线 | projectObservation 成为 DSH 一等接缝 | ✅（超额完成） |
| 后台候选 fencing | 15 §2 candidate key 维度完整 | ✅ |
| 可校准成本控制器 | 13 §4 net value + 分桶统计 | ✅（cache 项未闭环，见 A1） |
| 收敛首发复杂度 | 语义上简化（无 multi-region），系统上更大 | ⚠️ 半吸收（见 A3） |

报告 3 指出的设计包工程缺陷（manifest 绝对路径、缺 requirements、schema 无跨字段约束）在本包**全部修复**（相对路径 manifest、requirements.txt、validator 跨字段检查——均实测确认）。

### 8.2 报告消化代理提出的 12 项"易遗漏项"核对

10 项完全吸收（claim 极性/phase gate/外部副作用/有界目录/I_eff/fail-closed/CAS 事务/fencing/boundary-local 评测/net value 公式）；2 项部分吸收：

- **cache 显式建模**：有公式项无布局约束与发布门（= A1）；
- **主动召回**：有 gap detector 但触发面窄于报告 4 §8.9 的每 turn 轻量 recall query（= A2 的一部分）。

这个吸收率验证了规格作者确实系统性消化了全部参考材料；两个未闭环项恰好也是本评审的两个 P0——它们是四份报告共识中"最难做对"的两条，不是疏忽而是硬问题。

---

## 9. 补充与完善建议（按优先级）

### 9.1 P0 — 实施前必须完成

1. **新增一章"Prompt Cache 与布局经济学"**（建议编号 12b 或并入 12/13 章）：
   - 三段式布局硬约束：`[逐字稳定前缀: system/tools/hard commitments/continuity-stable]` → `[追加区: recent tail（只增不改）]` → `[易变尾部: directory/leases/retrieval pages/continuity-delta]`；
   - directory/lease 等每请求可变内容一律置于 tail 之后；
   - `cache_hit_ratio` 进入 33 章主指标、34 章发布门（建议初始门：balanced profile 下多 turn 会话前缀命中率 ≥ 60%，随 benchmark 校准）；
   - 对 DeepSeek/Anthropic/OpenAI 三家缓存机制的差异做适配说明（断点式 vs 自动前缀）；
   - 后台 semantic 调用参照 pi-mono 实践显式声明缓存策略。
2. **用户消息全保留不变量**（回应 A2）：authenticated user 原文永不有损降级；gap detector 增加 per-user-turn 轻量召回；benchmark 增加 constraint recall @ N turns。
3. **裁决 D4（数据目录/隔离边界）**：明确 per-workspace 还是全局 DB，并同步修订安全声明与备份/GC 章节。
4. **上游策略重定位**（回应 C1）：RFC 回应 2026-06-18 Agent Note 的历史决策；fork 并行轨道默认化；PR-4 与 26 §5 的 deprecation 矛盾（D7）择一。

### 9.2 P1 — Alpha 前完成

5. 修复 D1–D6 全部接口/布局漂移，并给 validator 增加跨文档接口一致性检查。
6. 补 `appendSkippedToolCall` 路径的投影/receipt/replay 规则（C2）与 `toolResultPruner` 服务共存说明（C3）。
7. **view blob 增长策略**：每请求全量 rendered view（数百 KB）× 长会话数百请求 = GB 级；建议 per-section 内容寻址去重（稳定前缀天然去重）+ 独立 retention 档（receipt 永久、view blob 可配置滚动），并把它加入 R04 与 31 §6 容量表。
8. **存量会话降级 onboarding**（回应 36 §6 过硬语义）：evidence pipeline 本以 DSH event replay 为输入（T19），对 pre-DCR session 可执行降级 catch-up（无 raw blob 的事件按 pointer-unavailable 处理、相关 claim 标 degraded provenance），把"老会话只读"从硬限制变成可选降级。采纳阻力显著降低，且不违反任何不变量。
9. **W1 中间验证点**（回应 A3）：ingress + exact recall 的最小组合对基线跑 smoke benchmark，先于 Claims/Lease 取得净值信号。

### 9.3 P2 — 实施中处理

10. `role:"user"` 注入 DCR 状态的替代方案评估（system suffix / 专用 role 的 provider 兼容性矩阵），避免 agent-derived 内容与真实用户输入在模型侧混淆。
11. 性能 SLO 现实性 spike：50ms P95 物化（含 worker RTT + token 复核）与 10ms spool fsync（macOS `F_FULLFSYNC` 显著慢于普通 fsync）建议在 T10/T11 阶段用微基准提前验证，必要时调整 SLO 而非留到 release gate。
12. Linux headless 的 key 管理默认路径（无 keychain 时的 key file + 权限 + 轮换）写入 31 §5。
13. `tokenizerRevision` 的来源与维护机制（DeepSeek tokenizer 版本如何获取/固定）落地到 26 章。
14. peer dependency 的 prerelease 匹配策略（C4 教训）写入 30 §4。

---

## 10. 风险登记核对与最终建议

42 章 R01–R18 覆盖良好。基于本评审证据，三处需要修订：

- **R01（上游拒绝）**：概率"中"→"中高"（C1 证据）；控制措施补充"回应历史设计决策的 RFC 论证"。
- **新增 R19：前缀缓存命中率坍塌**——概率高、影响高（成本目标直接失败），控制：三段式布局 + cache_hit_ratio 发布门（§9.1）。
- **新增 R20：用户约束抽取漏检**——从 R05 中独立出来（R05 泛指 claim 抽取，本项特指"每请求物化模式下漏检不可自愈"这一新失败模式），控制：用户消息全保留不变量（§9.1-2）。

**最终建议**：按 §9.1 四项 P0 修订规格后进入 W0。方向正确、基础扎实、纪律罕见；剩下的是把两块所有对照系统都没解决过的硬问题（缓存经济学、抽取召回兜底）从"已知风险"变成"已设计约束"，以及把与 DSH 上游的关系从乐观假设变成可执行的双轨计划。

---

## 附录 A：证据与来源速查

- 包完整性：`validate_artifacts.py` PASS 1946 checks；`MANIFEST.sha256` 全 OK（本评审实际运行）。
- DSH 源码：HEAD = 规格基线 commit（精确匹配）；`agent.ts:339-342`（时序倒置）；`tool-calls.ts:146-160/249-259/268-289`（插入点与平行路径）；`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md`（上游历史决策）。
- dsh-compaction-instant：v0.1.4，35 测试（29 pass / 6 fail，均为缺 peer 依赖）；peer range `^0.1.0-rc.6` prerelease 陷阱。
- 定价来源：platform.claude.com prompt-caching；openai.com api-prompt-caching；api-docs.deepseek.com news0802 + kv_cache 指南。
- 项目来源：github.com/ranxianglei/billion-context-pi、github.com/ranxianglei/acp-kernel、github.com/Tyan66666/billion-context-dsh、badlogic/pi-mono coding-agent compaction 文档、manus.im context engineering 博客、anthropic.com effective-context-engineering。
- 论文核验：附录见 §7.1 表（7/7 通过）。
- 参考报告：四份全部完整消化；报告间事实矛盾一处（"pi-press" 仓库存在性，报告 3 引用的 `sunnyx11/pi-press` commit 与报告 2/4 的"未找到"结论冲突）——DCR 规格未引用该项目，不受影响。

## 附录 B：本评审未覆盖范围

- 未验证 6 个 DSH PR 的实际可编译性与测试通过性（需实施期确认）。
- 未评审 16 份 ADR 全文与 12 份 RFC 全文的逐字一致性（抽样未见问题，但 D1–D8 类漂移可能同样存在于未抽样文件）。
- 未对 examples/*.json 与 schema 的语义合理性逐一人工复核（validator 已做结构校验）。
- 性能 SLO 数字未做任何实测，全部按"工程初始值待校准"（规格 39 §6 自己也如此声明）对待。
