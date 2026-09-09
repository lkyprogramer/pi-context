# 测试协议（6.1）：在自己的 4090 上，用真实 Pi 会话回答一个问题

问题只有一个：**在 Pi 0.85.1 + 现网 `openclaw/Qwen3.8-27B-WORK`（NInfer，262k，prefix cache 有效）上，balanced 的阈值折叠是否在不伤质量的前提下推迟了原生压缩并保留了精确回读；如果没有，observe+history 是否已是完整、安全的交付。**

## 三层证据，各自只回答自己的问题

| 层 | 在哪跑 | 回答 | 不回答 |
|---|---|---|---|
| 单元/属性（A–C 任务） | vitest，无 Pi | 合同与算法正确 | 宿主接线、模型行为 |
| 真宿主受控（D01，W01–W03） | 官方 pi SDK + 受控 provider | 插件确实改变/不改变发往 provider 的字节；ref 可回读；compact 后失效 | 真模型是否会用、成本 |
| 4090 本地矩阵（E03，L/H） | 官方 pi SDK + 现网模型 + 容器判题 | 质量无回归、折叠是否触发、cacheRead/prefill 实际变化、模型是否真的回读 | 其他模型/云 Provider、多用户 |

三层都通过才允许 `limited-balanced-trial`；任一层否定，停在 `observe-only`，仍算完整交付。

## Arm 定义

- `native`：官方 Pi，不加载插件。agentDir 无 extensions。
- `observe`：加载 `dist/extension.js`，`pctx.json` profile=observe。发往 provider 的消息与 native 相同，多一个 `pctx_history` 工具 schema。
- `balanced`：同上，profile=balanced，fold 默认 60/40/4/4096/1024/120。

每 episode 先读 `/pctx status` 等价 API 的 `resolvedProfile/configHash/hostVersion`，与 manifest 不一致 → `blocked`，不计入。native 若发现插件被加载 → `blocked`。

## 场景集（[scenarios.json](scenarios.json)）

- **W01–W03 机制**：D01 的 vitest，不消耗 4090。
- **L01–L06 质量**（w262k，native vs balanced，各 2 次）：真实 Java 修复题，全部有可信 verify/Oracle。生产窗口下短任务不会触发折叠，所以这一组测的是：加载插件 + `pctx_history` schema 是否让模型变差或变慢；以及"balanced 不折叠时与 native 等价"的实证。
- **H01/H02 能力**（w64k，三臂，各 2 次）：用 E01 录制的真实种子历史（≥40k token，含 nonce 与一次真实 verify 失败）继续新任务。w64k 让折叠 trigger（≈39k）与原生阈值（≈49k）都在可触及范围。H01 测精确回读是否必要且可用；H02 测错误结果不会被折叠。
- **H03 观察**（w262k，balanced，1 次）：一个真实长会话，看折叠在生产窗口下何时触发、之后 cacheRead 如何恢复、是否避免了原生压缩。不参与质量判定。

每 episode 记录（[合同 §6](../design/01-contracts.md)）：oracle、每请求 usage（input/cacheRead/output）、插件机制计数（folds/replacements/historyReads/verifiedReads/nativeCompactions）、engine metrics 前后差值、墙钟。

## 从"能完成"升级为"历史确实必要"

H01 的 nonce 只存在于种子历史的一条 `bash` toolResult 里（录制后文件与 shell 历史删除），不在任何 prompt、文件、环境变量。三臂拿到同一种子 JSONL 副本与同一任务：
- native：nonce 在原文里（未压缩时）或在摘要里（压缩后，可能丢失）。
- observe：与 native 同，但模型可以用 `pctx_history search`。
- balanced：nonce 所在 toolResult 已折叠为 stub，模型必须 `pctx_history read` 该 ref。

报告分别给出：答对率、`historyReads`、`verifiedReads`（返回 `verified:true` 且 hash 匹配）、是否发生 compaction。**不把 native 因无工具而失败算成 balanced 加分**；balanced 的合格线是"答对且通过回读取得"。

## 记录的指标（每 episode，报告按 case×arm 配对）

| # | 指标 | 来源 | 报告列 |
|---|---|---|---|
| ① | Task success | `grade.sh` 可信判题（容器内） | pass/total |
| ② | Wrong-action | `protectedIntact=false` 或 `outsideEditable>0` | wrong-action |
| ③ | Input tokens | Pi `message_end` assistant `usage.input` | Σinput |
| ④ | Cache-read tokens | `usage.cacheRead`（Pi 归一化的 `cached_tokens`） | ΣcacheRead |
| ⑤ | Uncached input | ③ − ④ | Σuncached |
| ⑥ | 成本 | 本地栈无单价：用 engine `prefillTokensDelta`（实际 prefill 的 token） | engine.prefill |
| ⑦ | TTFT | harness `message_start → 首个 message_update`；插件 `RequestRecord.ttftMs` 互校 | TTFT p50 |
| ⑧ | 端到端时延 | episode 墙钟 | wall p50 |
| ⑨ | Compaction 次数 | `compaction_end` 事件 / StatusView | native compactions |
| ⑩ | Recall 次数 | `pctx_history` read/search 调用数 | history reads |
| ⑪ | Recall 成功 | `verified:true` 且 hash 匹配 | verified reads |
| ⑫ | Lost critical evidence | H02 `quotedVerbatim===false`（离线从 episode session 判定） | lost evidence / known |
| — | 折叠经济学 | `FoldEvent.savedTokensEstimate / invalidatedTokensEstimate` | removed/invalidated |

缺失值一律记 unknown / n/a，不记 0。

## 决策规则（E04 机械执行，不解释性调参）

设质量集 `Q = L01–L06`，每 case×arm 通过数 `p`。

1. **质量门**：对每个 case，`p_balanced ≥ p_native − 1`（允许一次模型随机波动）；若任何 case 出现 `p_balanced ≤ p_native − 2` → `observe-only`。同一 case 内 balanced 的 wrong-action 数不得大于 native，否则 → `observe-only`。
2. **机制门**：H01/H02 的 balanced 4 个 episode 中 ≥ 3 个满足 `folds ≥ 1`；H01 balanced 答对、nonce 所在 toolResult 已折叠、且 `nonceVerifiedReads ≥ 1`（非空页含 nonce 且 `sourceHash` 与原文块匹配）的 episode ≥ 1；H02 balanced 无一个 episode 折叠了 isError 结果。折叠证据或回读计数缺失记 unknown，不得过门。任一不满足 → `observe-only`。
3. **成本门**：H01/H02/H03 中折叠后的第一条请求 `cacheRead` 应显著下降（前缀作废，预期行为），其后 ≥ 2 条请求 `cacheRead/input ≥ 0.5`；且 H03 中原生 compaction 次数为 0 或晚于 native 同用量下的预期。engine 的 `prefillTokensDelta` 在 balanced 不得高于 native 同 case 的 1.5×（否则折叠代价超过收益）。`cacheRead` 通道全 0 / 缺失，或 capability 格 engine 指标 unknown，记 unknown 且不得出 `limited-balanced-trial`。不满足 → `observe-only`。
4. 三门都过 → `limited-balanced-trial`：README 标 "default-off, trial in this environment"，仍不改默认 profile。
6. **6.2 立项信号（不影响上面四条，可同时触发多个）**，报告决策段 `candidates:` 列出命中的项，均无则 `none`（[00-target §6.2](../design/00-target.md)）：
   - `post-compaction-evidence-delta`：H02 任一臂 `lost evidence ≥ 1`。
   - `inline-ref-marker`：H01/H02 的 observe 或 balanced 臂中，`historySearches ≥ 1 且 verifiedReads = 0` 的 episode ≥ 2（会搜、搜不到 ref）。
   - `fold-time-model-hint`：H01/H02 的 balanced 臂中，`folds ≥ 1 且 historyReads = 0 且 historySearches = 0 且 oracle 失败` 的 episode ≥ 2（stub 在场但从未尝试搜索或回读）。
   这三项需要 episode 级机制计数，`report.mjs` 从 `EpisodeResult.mechanism` 逐 episode 判定，不用 cell 汇总值。
5. `blocked` episode 超过总数 20%，或 engine 中途变化（`n_ctx` 变、计数器归零）→ `inconclusive`，先补跑，不下结论。

样本量小（每格 2 次）是个人项目的现实；报告只写通过数/总数与观察到的机制，不写百分比外推、不写"优于 native X%"的结论。

## 禁止事项

- 看到某个 case 结果后调 fold 参数再重跑并只报告后一次。参数调整需新 runId 并在报告中并列。
- 用 `pctx_history` 的 mock 或预填答案替代真实回读。
- 把 vitest 通过写成"4090 验证通过"。
- 在 4090 机器上改任何配置、停 unit、开评测容器。E 阶段只通过 18343 隧道访问现网。
- 在报告或文档中出现 NGINX token、SSH 口令。
