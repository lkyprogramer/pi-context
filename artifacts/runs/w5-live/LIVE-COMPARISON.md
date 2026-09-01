# Live 对照完整报告（2026-09-01）

HEAD `a6281b3a62197113a6c3aba1b5cca01e6864281d`  
Pi `@earendil-works/pi-coding-agent@0.84.4`  
模型 `openclaw/Qwen3.8-27B-WORK`（`models.json`：`contextWindow=200192`，`maxTokens=16384` 未改）  
决策：**`keep-pi-native`，`publicationClaim=false`。不能宣布 PCR 压缩器优于 Pi Native，也不能当发布 Gate。**

本轮四条都用了真实 OpenClaw 端点，不是 hermetic stub。

| 条 | 入口 | 结果 | 可否当发布证据 |
| --- | --- | --- | --- |
| 100×3 live B0/B1 | `PCR_W2_LIVE_PROFILE=gate` | **300/300 same-cut**，Hard 失败，Efficiency 数字过门，总决策 `keep-pi-native` | 否（Hard 失败） |
| 200k natural threshold | 未改窗口 + 默认 `keepRecent=20000` / `reserve=16384` | **未触发** threshold compact | 否 |
| 真实 provider overflow | 关 auto-compact 后加长 prompt | **未观测到 provider 400/overflow** | 否 |
| recursive 长程 live | 3 次 compact + 校正 + branch + restart | **只完成 compact-1**，compact-2 起 `Nothing to compact` | 否 |

---

## 1. 100 pair × 3 seed live（B0 Native compact vs B1 PCR hook）

- 时间：2026-09-01T02:15:55Z → 03:41:51Z（约 86 分钟）
- 产物：`artifacts/runs/w2-live-native/gate/{report,gate-decision,run-manifest}.json`
- `reportHash`：`3f7ce8af5be105ebb63ff356c49393fe8d4006fa9c6bcbabe406f4ed2d6bf6cb`
- 切点策略（与历史 spec-smoke 相同，不是 200k 自然阈值）：`keepRecentTokens=2048`，`reserveTokens=16384`
- B0：`pi --no-extensions`，RPC `session.compact()`，`fromHook=false`
- B1：`pi -e apps/pi-context-runtime/dist/extension.js`，`fromHook=true`

### 样本

| 项 | 值 |
| --- | --- |
| 期望 | 100 case × 3 seed = **300** |
| 完成 | **300/300** |
| arm 失败 | 0 |
| same-cut | **300/300** |
| replicates | **3** |

### 中位数（n=300）

| 指标 | Pi Native B0 | PCR B1 | 差值 |
| ---: | ---: | ---: | --- |
| compact 产物 token | **406.5** | **13** | −96.8% |
| 下一轮 probe input token | **517** | **141** | **−72.7%** |
| compact 延迟 p50 | 8706 ms | 1851 ms | −79% |
| must-omit 泄露 | **57/300** | **0/300** | 插件不泄 |
| 闭环问答（弱 scorer） | 299/300 | 296/300 | 接近 |

Gate 用的 Efficiency：`tokenMedianRelativeDelta=−0.719`（门槛 ≤ −0.15），`realizedNetMedian=371`（门槛 > 0）。**数字过了 Efficiency 门。**

### Hard 失败原因（所以不能 adopt）

| Check | 观察 | 门槛 |
| --- | --- | --- |
| B1 `fromHook` | 300/300 true | 必须 |
| B0 Native | 300/300 `fromHook=false` | 必须 |
| B1 must-omit leak | 0 | 必须 0 |
| Native leak | 57（几乎全在 tool-heavy 60 对里） | 对照 |
| B1 directiveCoverage | **0**（不是每对都覆盖硬指令） | 必须 1.00 |
| exactEvidenceRecovery | **0** | 必须 1.00 |

`exactEvidenceRecovery=0` 仍是 live `scoreArm()` 把 `recovered` **写死 false**，这条 Hard 在当前实现下不可能过。

directiveCoverage=0 是新问题：B1 可见 checkpoint 中位只有 **13 token**，比 2026-08-31 spec-smoke 的 117 token 更短，probe 也更短，但 **temporal-update 质量均值 0.25 vs Native 0.95**，硬指令几乎没进下一轮。效率变好来自摘要过短，不是指令保住了。

### 分族（中位）

| 族 | n | Native 摘要 | PCR 摘要 | Native probe | PCR probe | Native 泄密 | 闭环 B0/B1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| tool-heavy | 60 | 498.5 | 13 | 718.5 | 177 | **57/60 vs 0** | 60/60 |
| constraint | 60 | 420.5 | 13 | 539 | 165.5 | 0 | 60/60 |
| temporal-update | 60 | 404 | 13 | 521 | 133.5 | 0 | 60/60 |
| branch | 60 | 352 | 13 | 462.5 | 125 | 0 | 59 / 56 |
| overflow 族（语料标签，不是 provider overflow） | 60 | 381 | 13 | 463 | 130.5 | 0 | 60/60 |

Gate：`keep-pi-native`，`hardGatePass=false`，`publicationClaim=false`。

相对 2026-08-31 spec-smoke（30×1，HEAD `48578be`）：当时 probe Δ **+2.41%**、净值 **−11.5**；本次 300 对 probe Δ **−71.9%**、净值 **+371**。对比的是同一套 live Native compact，但 PCR checkpoint 形态已经变了（13 token vs 117），不能把两次数字直接合成一条趋势当发布证据。

---

## 2. 200k natural threshold

Pi 文档阈值：`contextTokens > contextWindow - reserveTokens` → **183808**。  
默认 `keepRecentTokens=20000`（**没有**改成 2k 来伪造压力）。

入口：`tests/live-gate/w5-live-lanes.ts` `runNaturalThreshold`。  
产物：`artifacts/runs/w5-live/natural-threshold.json`。

操作：Native 与 PCR 各 40 轮 live prompt（每轮约 40k 字符 filler），auto-compact 开着。

| 臂 | 轮次 | compaction 条数 | 是否 threshold |
| --- | ---: | ---: | --- |
| Native | 40 | **0** | 否 |
| PCR | 40 | **0** | 否 |

`triggered=false`。模型广告 200k，但后续 overflow 条里一次成功 compact 的 `tokensBefore` 只有 **~36k**。live 上下文没有涨到 183808，所以这条 **不是** 成功的 200k 自然阈值实验。

---

## 3. 真实 provider overflow

关 auto-compact，25 轮加长 prompt，再追加超大 prompt，然后 `compact()` + 短 retry。  
产物：`artifacts/runs/w5-live/overflow.json`。

| 项 | 观察 |
| --- | --- |
| grow 25 轮 | 全部 `ok: true`，无 API overflow |
| 追加 overflow prompt | **成功**（`overflow-prompt.ok=true`） |
| compact | 成功，`tokensBefore=36320` |
| retry | 成功，hash 与 compact 不同 |
| `overflowObserved` | **false** |

没有抓到 provider `context_length` / 400。compact→retry 的 hash 变化成立，但那是手动 compact，不是 overflow 恢复。

---

## 4. Recursive 长程 live

目标：≥3 次 compact、compact2 后 branch、restart 后再 compact3、校正、recall。  
产物：`artifacts/runs/w5-live/recursive.json`。

| 阶段 | 结果 |
| --- | --- |
| compact-1 | **成功**（count=1） |
| temporal-update（改为 version 7） | 成功 |
| compact-2 | **失败**：`Nothing to compact (session too small)` |
| branch / restart / compact-3 | 未执行到 |

`threeCompacts=false`。默认 `keepRecent=20000` 下，compact-1 之后会话低于可切阈值。

---

## 总判

1. **唯一完整跑完的对照**是 100×3 live Native vs PCR hook：300/300 same-cut，真实 `session.compact()`。
2. Efficiency 数字过门（probe −72%，净值 +371），Hard 不过（指令覆盖 0 + recovery 写死 false）。
3. 200k / provider overflow **没有**在广告的 200192 窗口上打到阈值或 API overflow；观察到的 live compact 上下文大约停在 36k token。
4. Recursive live **没有**完成三轮压缩。
5. 仍 **`keep-pi-native` / `publicationClaim=false`**。未 npm publish。

### 原始文件

- 100×3：`artifacts/runs/w2-live-native/gate/report.json`（gitignore，不入库）
- 100×3 Gate：`artifacts/runs/w2-live-native/gate/gate-decision.json`
- 200k / overflow / recursive：`artifacts/runs/w5-live/*.json`
- 本报告：`artifacts/runs/w5-live/LIVE-COMPARISON.md`

## 后续（同日 Wave A 之后）

compact 从 `messagesToSummarize` 回填指令后，`PCR_W2_LIVE_PROFILE=one` 与 spec-smoke **30/30 Hard 已过**（`directiveCoverage=1`，`recovered=true`，probe 中位 580.5→200）。上面 §1 的 100×3 数字仍是回填前的 300 对，未重跑。`publicationClaim` 仍为 false。
