# 目标设计

不变：官方 Pi 0.85.1 单插件；默认 observe；balanced 显式开启；折叠只作用 ActiveView 上已 derived-exposed、非最近 4 批、非 isError、纯文本的工具结果；折叠参数 60/40/4/4096/1024/120；`pctx_history` 搜索/回读协议；父进程 broker 持 Key。

本轮改动集中在评测与两处边界。分节对应任务：§1→S01，§2→S02，§3→S03，§4→S04，§5→S05，§6→S06，§7→S07，§8 为 6.2 候选登记。

## 1. 见证规则（S01）

定义三层：

- `derived exposure`：`exposedEntryIds(branch)` —— toolResult 之后在同一分支存在 `stopReason ∉ {error, aborted}` 且 usage>0 的 assistant。**这是折叠的必要条件，由 planner 硬过滤，不可绕过。**
- `persisted confirmation`：会话文件里已经满足 derived exposure 的字段，进程启动后无需再经一次本进程 wire 往返即可折叠。`44e8333b` 引入，本轮保留，但 `confirmPersistedFields` 必须只对 `exposedEntryIds` 命中的字段调用 `confirmPersisted`，使 `witness.has()` 与 planner 的过滤语义一致。
- `wire witness`：本进程内 `before_provider_request` 观察 + assistant ACK。对本进程新产生、尚未被 session 文件中后续 assistant 覆盖的字段仍是唯一确认途径。

与第 7 轮包 R03 的差异必须写入 `docs/iterations/next-fixes.md`：原因（resume 后首请求本来就是冷的，此时折叠无缓存代价；折叠后的可回读性来自 `pctx_history`，与哪个模型"看过"无关）、影响（P02 兄弟分支/P03 压缩后暴露仍由 ActiveView 分支范围与 `compactionBoundary` 隔离）、残余风险（模型切换后新模型只见 stub——与任何折叠等价）。

## 2. 目标计算（S02）

对每个 quality pair `(caseId, rep)`：

```text
metricOf(episode, metric):
  fresh-input   = Σ requests[].normalized.freshInput        （任一 request 为 null → null）
  logical-input = Σ requests[].normalized.logicalInput
  wall-time     = episode.wallMs
  monetary-cost = 需 pricingIdentity，本栈 null
objective.value(metric) = Σ_pairs candidate / Σ_pairs native − 1   （任一 pair 任一侧 null → known=false）
```

主目标 `fresh-input`，`minImprovement 0.1`。**理由**：本地 prefix-cache 引擎上 cached tokens 的计算成本接近 0，`logical-input` 会在任何折叠下自动"获胜"（三次 run −57~−71%），不构成证据；`fresh-input` 是 GPU 预填的直接代理，也是唯一能把 warm/cold 两种 regime 区分开的指标；`wall-time` 混入工具执行与网络噪声，作次要目标。选择 `fresh-input` 是在看过数据后做的，但它是对候选最严的一项，且在 S07 干净重跑前冻结，S07 不得更换。

次要目标一律计算并写入 `report.json.objective.secondary`，不参与裁决：`logical-input`、`wall-time`、`cacheRead`、`engine.prefillTokensDelta`、`nativeCompactions`、`requests`。

## 3. 判定规则（S03）

输入：pairs（每 case `reps` 个）、capabilities、objective、attempts、plan。顺序：

1. 任一 pair `criticalViolation` → `blocked`。
2. `pairs.length !== expectedPairs` 或任一 pair 任一侧 `passed == null` → `inconclusive`（"planned denominator incomplete" / "missing quality outcome"）。
3. 任一 `foldRequired && !foldApplied` → `inconclusive`（"optimization not exercised"）。
4. `exactQuoteIds` 内 case：candidate `quotedVerbatim == null` → `inconclusive`（"required evidence unmeasured"）。
5. 不一致统计：
   - `b` = candidate 败 且 native 胜 的 pair 数（`quotedVerbatim` 为必需的 case 上，candidate quote false 且 native quote true 也计入 `b`）
   - `c` = candidate 胜 且 native 败
   - `shared` = 双败
   - `bByCase[caseId]`
   触发 `review-needed`：`∃ case: bByCase ≥ 2` 或 `b − c ≥ 2`。reason 必须列出全部不一致 pair（`Q05/r2 candidate-fail-native-pass`）。
6. `expectedCapabilities` 不满 → `inconclusive`；任一 capability `!eligible || !passed` → `inconclusive`（"capability unproven"）。
7. `objective.primary.known !== true` → `quality-qualified-cost-unknown`。
8. `relativeChange > −minImprovement` → `history-only`；否则 `limited-balanced-trial`。

与第 7 轮"不因每题只少一次而忽略"的差别：单个不一致 pair 不再直接否决，但 (a) 全部写入 reason，(b) `b − c` 与 case 级 `b ≥ 2` 仍否决，(c) `reps` 由 2 提到 3。理由：native 基线 87–94%，2 rep 下"任一失败即否决"的结论与候选质量无关。`shared` 失败在 report 中标 `task-noise`，不进 `b`。

`decision.discordant`、`decision.attemptRates`、`decision.objective` 为必填结构化字段；`report.md` 的 decision 段只渲染它们，不得手写覆盖。

## 4. 精确引用、候选信号、provenance、dirty 拒绝（S04）

- Q05 `cases.json` 增加 `evidence: {kind:"verbatim-quote", sourceKind:"any", linePattern:"idempotency broken: reservation ZX-731 replayed after callback\\."}`；`verbatimQuote` 增加 `sourceKind: "isError" | "any"`（默认 `isError` 保持 H02 行为）。`plan.exactQuoteIds = ["Q05"]` 取代 gate 中硬编码的 `"H02"`。
- `candidates(summary, episodes, plan)`：
  - `fold-time-model-hint`：balanced、`folds ≥ 1`、`historyReads = 0`、`historySearches = 0`、`oracle.passed === false`；≥2 个 episode 达门；不足时输出 `below gate (n/2)`。
  - `inline-ref-marker`：`historySearches ≥ 1` 且 `verifiedReads = 0`；≥2。
  - `post-compaction-evidence-delta`：仅 X lane，native 臂 `nativeCompactions ≥ 1` 且 `quotedVerbatim === false`，同 rep balanced `quotedVerbatim === true`；≥2。
  - `cold-aligned-fold`：见 §8，需 W lane 与 Q lane 同时存在。
- provenance：manifest 增加 `distDigest = sha256(JSON.stringify(sorted distFiles))`；报告头改为 `dist <distDigest12>`；`pluginSha256` 保留但标 `entry`。tarball 字段保留但报告不再展示。
- live 模式：`git status --porcelain` 非空时拒绝启动，除非 `--allow-dirty`；带该标志的 run 在 manifest 写 `diagnosticOnly: true`，report 的 decision 强制 `inconclusive`（reason `dirty-tree diagnostic run`），并在 `report.md` 头部加粗提示。
- 删除 `report.mjs` 中不再被 CLI 调用的 `decideGates/decide`（v6.0.0 旧三门）或改名 `legacyDecide` 并注明不参与裁决；尾注改为动态 `reps per cell`，删除 w262k 句。

## 5. Darwin 沙箱（S05）

Linux 路径不变。Darwin 路径改为：

```text
docker volume create pctx-sock-<rand>
sidecar: --network bridge（默认） -v pctx-sock-<rand>:/run/pctx
         node broker-unix.mjs   ← 从 stdin 读 upstream key，socketPath=/run/pctx/broker.sock
agent:   --network none          -v pctx-sock-<rand>:/run/pctx
         PCR_BROKER_SOCK=/run/pctx/broker.sock （与 Linux 容器内 unix-relay 相同）
```

Key 只经 `docker run -i` 的 stdin 进入 sidecar 进程内存；宿主不写文件；`broker-hop.json.kind = "darwin-sidecar-volume-network-none"`。`secure-preflight --canary` 在 Darwin 上增加一条：agent 镜像以同样参数启动后 `fetch(baseUrl)` 必须失败（`net:false` 表示无出网）。run 结束 `docker volume rm`。

## 6. 场景 lane（S06）

| lane | 目的 | case | 臂 | reps | seed usage | 触发方式 | 主要读数 |
|---|---|---|---|---|---|---|---|
| Q | 机制 + resume 冷启动 regime（现有） | Q01–Q08 | native, balanced | 3 | 65% | 首请求即折叠 | 质量、fresh-input |
| C | 能力（现有） | C01, C02 | balanced | 3 | 65% / 30% | — | 多页回读、跨分支检索 |
| W | warm 会话中折叠 regime | W-Q01, W-Q03, W-Q05, W-Q07 | native, balanced | 3 | 45% | TASK 先要求 `cat` 两份 fixture 内 ≈6k-token 真实文件，再提问；越过 60% 发生在第 2–3 请求 | fresh-input、wall、cacheRead 序列 |
| X | 长会话、native compaction ≥2 | X01 | native, balanced | 3 | 无 seed | 12 份 600 行日志分 6 批 `cat`，w64k 下 native 预计压缩 2–3 次；oracle：精确引用第 7 份日志第 410 行 `FIRST-ERROR-MARKER` 整行 + 写入 `marker.txt` | 质量、quotedVerbatim、nativeCompactions、fresh-input |
| G | 受控守卫（现有） | G01, G02 | — | — | — | 受控 Provider | 无回归 |

W lane 的 seed 复用 Q 的 witness 与 oracle，但 pad 正文换成 fixture 内真实文件（`initial/` 下源码与 `TASK.md` 拼接到 ≥4096 tokens），使折叠移除的是模型可能重读的内容。W 与 X 的 pair 不进主质量分母，各自输出 `regimes.warm` / `regimes.long`：`{pairs, b, c, shared, objective{primary, secondary}}`；任一 lane 的 `criticalViolation` 仍使全局 `blocked`。

主分母：Q lane 8×3 = 24 pair。能力分母：C lane 6。总 episode：48 + 6 + 24 + 6 = 84。

## 7. 干净重跑与文档同步（S07）

- 前置：S01–S06 GREEN、`pnpm check` 0、`pnpm build && pnpm smoke` 0、`git status --porcelain` 空、`secure-preflight --canary` 0（Darwin 需 `net:false`）。
- 运行：`PCTX_LIVE=1 node eval/local/run-matrix.mjs --mode live --config eval/local/review-matrix.json --out artifacts/local-eval/review-r8-<date>`；中断用 `--resume`；不得删除已完成 episode 目录。
- 产出：`report.json/report.md`、`bundle/`（脱敏）、`artifacts/local-eval/review-final/` 覆盖为本次 bundle、`CURRENT_RUNID` 更新。
- 文档：README/HANDOFF/OPERATIONS/CONFIGURATION 的决策句与 `review-final/report.json.decision.decision` 字面一致；新增 `test/unit/docs-decision-consistency.test.ts` 机械核对。
- 允许的结论只有五值枚举 + `blocked`；任何一个 lane 未跑完 → `NOT_RUN` 留在分母，主决策 `inconclusive`。

## 8. 6.2 候选登记（不实现）

- `cold-aligned-fold`：只在本来就冷的请求上折叠（resume、model/provider 切换、native compaction 之后），warm 会话中把触发阈值提高到第二档（如 75%）。**判据**：Q lane `fresh-input.relativeChange ≤ −0.3` 且 W lane `fresh-input.relativeChange ≥ −0.05`。若成立，说明折叠收益几乎全部来自冷点，值得实现；若 W lane 也有 ≤ −0.1 的收益，则不需要。
- `fold-time-model-hint`：判据不变（≥2 个"折叠后未回读且失败"的 episode）。fold1 run 为 1/2。
- `inline-ref-marker`：判据不变。
- `post-compaction-evidence-delta`：仅当 X lane 出现 ≥2 次 "native 压缩后引用失败、balanced 同 rep 成功"。

## 红线

不改默认 observe；不改折叠参数；不改 oracle 让失败变成功；不在 dirty tree 上产出交付；不把 Key 写入任何文件；不用 `logical-input` 作主目标；不在 S07 前后更换主目标；不合并 W/X pair 进主分母；不删除任何已有 run 目录。
