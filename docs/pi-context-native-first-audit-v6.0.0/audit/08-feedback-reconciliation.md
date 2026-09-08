# 外部反馈核对（2026-09-08）：`codexPlans/pi.md` 对 6.1 的影响

反馈来源：用户提供的 GPT 评估稿 `/Users/luo/Documents/codexPlans/pi.md`（针对 Pi #128 / Discussion #330 落地后 pi-context 的去留）。本页逐条核对其事实与建议，标明**已核实 / 已采纳 / 部分采纳 / 拒绝及理由**。核对对象：`/Users/luo/Documents/github/pi` HEAD `b2602be`（`packages/coding-agent` 0.85.1）与本包 6.1 设计。

## 1. 事实核对

| 反馈陈述 | 核对结果 | 依据 |
|---|---|---|
| #128 under-compaction 已完成，Pi 支持 split-turn | **已核实** | `compaction.ts:403 findCutPoint()` 返回 `isSplitTurn`；`turnPrefixMessages` 单独摘要后合并 |
| 工具结果加入后、下一次 assistant 请求前检查阈值，同一 run 内 compact 后继续 | **已核实** | `agent-session.ts:542 _compactBeforeNextAssistantResponse`，挂在 `prepareNextTurnWithContext` |
| #330 给的是 `context` 事件，扩展非破坏地改工作视图，原 session 不动 | **已核实** | `runner.ts:1039-1055`，`structuredClone` 后传入；`agent-loop.ts:288 transformContext` |
| 原生摘要含 Goal/Constraints/Progress/Decisions/Next Steps/Critical Context/read-files/modified-files | **已核实** | `compaction.ts:471-532, 950-962` |
| "pruning 的代价是 cache busting" | **已核实并量化** | [07-local-stack](07-local-stack.md)：改旧消息后命中 0，重 prefill ≈ 2000 tok/s |
| Pi Native 对 overflow / within-turn / retry 的覆盖"很高" | **已核实** | `_checkCompaction` 三种自动路径 + `_overflowRecoveryAttempted` 单次重试 |

补充一条反馈未提到、但对设计有约束的事实：run 内阈值检查发生在 `context` 事件**之前**，输入是"最后一条真实 usage + 原生 trailing 估算"（[05 §6.1 第 9 条](05-native-pi.md)）。折叠效果要到下一条 assistant usage 才被 Pi 看到。

## 2. 建议逐条处理

| # | 反馈建议 | 处理 | 落点 |
|---|---|---|---|
| §2 | 防溢出、within-turn、trigger/retry、普通摘要交给 Native | **已采纳**（6.1 原本如此） | [00-target 产品定位](../design/00-target.md)、[02 §8](../design/02-fold-algorithm.md) |
| §4 | 产品定义改为 "Evidence / Recoverable & Cache-Aware Context Layer" | **已采纳** | 00-target 新增"产品定位"节；README 首段 |
| §5 A | Evidence History 提升为第一核心 | **已采纳**（B01–B03 是 6.1 最大的一组任务，observe 默认开启） | tasks/B* |
| §6 B | Projection 保留，定位为 pre-threshold efficiency 而非 survivability | **部分采纳**：保留 fold，但**不**做"远未接近窗口时就裁"。在 85% prefix 命中的本地栈上，被缓存的旧 token 每请求几乎不再付 prefill，"每次重发 30K Maven log"不是每次重付 30K；提前裁只会提前付一次作废代价。折叠的收益定义为推迟原生 compaction 与缩短 KV，因此触发点放在 60%（Pi 阈值 93.75% 之前一个安全余量），不是 20–30% | [02 §6 / §6.1](../design/02-fold-algorithm.md) |
| §7 | 算 cache 账作为硬条件；Adaptive Expected Net Benefit（pricing、cacheRead discount、firstChangedIndex、future turns、recall cost、compaction proximity） | **部分采纳**：cache 账已是硬条件——折叠只发生一次、之后冻结、stub 字节稳定；`FoldEvent` 新增 `firstChangedIndex/invalidatedTokensEstimate`，报告呈现 `removed/invalidated`、`Σuncached`、TTFT p50、prefill delta。**拒绝**逐请求净收益重评估：本地单价为 0，公式退化为阈值+一次；逐请求重评估会把改前缀从每 ~60k token 一次变成潜在的每请求一次，正是 #330 警告的 cache busting。接付费 API 时 `RequestRecord.usage.cacheRead/cacheWrite` 已足够拟合成本模型，不需改机制 | [02 §6.1](../design/02-fold-algorithm.md)、[01-contracts FoldEvent](../design/01-contracts.md) |
| §8 C | Checkpoint 保留并升级为 source-backed "Verified Delta"（constraint / unresolved / workspace state / forbidden claim / next safe action） | **6.1 拒绝，6.2 有条件立项**：现有 capsule/pin 与原生摘要重复且改写 user 消息（F13），无一手证据；反馈方案中"constraint 提取""forbidden claim""next safe action"需要模型判断或人工 pin，属第二套摘要。只保留可**纯确定性**派生的子集（未被后续成功覆盖的 `isError` 结果 + 修改后未验证的文件），且只在 `session_compact` 后首次 `context` 追加到 summary 之后（此时前缀本就冷，零额外 cache 代价）。立项条件：E03 H02 出现 `lost evidence ≥ 1` | [00-target §6.2](../design/00-target.md)、[00-protocol 规则 6](../testing/00-protocol.md)、`report.mjs candidates()` |
| §9 D | Semantic 降级为 experimental，消融不显著则删 | **已采纳并更进一步**：6.1 直接删除（C01）。理由见 [06 §6.1](06-community.md)：JetBrains Complexity Trap 表明第二层 LLM 摘要无增益且拉长轨迹 | tasks/C01 |
| §10 | 明确删除 own session runtime / compaction scheduler / overflow recovery / within-turn pruning / retry / generic summary / auto continue | **已采纳**，写入 02 §8 | [02 §8](../design/02-fold-algorithm.md) |
| §11 | `src/checkpoint/pins.ts` 强化、`capsule.ts` 重构、`staging.ts` 简化 | **拒绝**（同 §8 C）：三者在 6.1 全部删除；6.2 候选若立项将是新的、无 pin 命令的确定性模块，不复用现有实现 | tasks/C01 |
| §12 | 12 项产品 gate 指标；判定式 `Quality(PCTX) ≥ Quality(Native) AND (Cost< OR Latency< OR LongTaskSuccess>)` | **已采纳指标**，全部映射到报告列（新增 wrong-action、Σuncached、TTFT p50、lost evidence）。**判定式部分采纳**：6.1 的三道门（质量不降 + 机制真实发生 + 折叠后 cache 恢复且 prefill 不超 1.5×）比"任一维度更好即可"更保守；样本量每格 2 次不支持"更好"的结论，只支持"不更差且机制成立" | [00-protocol 指标表与规则](../testing/00-protocol.md)、`report.mjs` |
| §13 | 停止扩展压缩算法，转向 Evidence + Recall + Cache-Aware Projection + Verified State | **前三项已是 6.1 全部内容**；Verified State 按 §8 C 处理 | 全包 |

## 3. 对任务 DAG 的影响

无新增任务、无删除任务。改动全部落在已有任务的交付面内：

- C03：`FoldEvent.firstChangedIndex/invalidatedTokensEstimate`、`RequestRecord.ttftMs`（消费 `message_start/message_update`）。
- E02：`grade.json.outsideEditable`。
- E03：报告新增列与 `candidates` 段；`parse-session.mjs verbatimQuote()`；`cases.json` H02 `evidence` 规格。
- 校验器无需改动；`validate_bundle.py` 复跑通过。

## 4. 未核实 / 边界

- 反馈把 "#300" 读作 Discussion #330，本页沿用；未访问 GitHub 核对 Discussion 文本，依据是本地 Pi 源码。
- 反馈对 `expectedBenefit()` "未进入 `planEpoch()` 核心决策"的描述针对 v5 代码，6.1 删除 `planEpoch` 后不再适用。
- 反馈引用的 "60%～70% 架构可保留"是估计，本包不采用比例说法；保留/删除以 tasks/C01 的文件清单为准。
