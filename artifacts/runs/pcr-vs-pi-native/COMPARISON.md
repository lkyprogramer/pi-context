# PCR vs Pi Native：按原始文档的 Gate 对照报告

插件 vs 原始 Pi compact 的效果数字在 [`EFFECT.md`](EFFECT.md)。下面是 Gate / 发布口径。

## 结论

**不能宣布 PCR 压缩算法或产品过了规格 W2 / 发布 Gate。`publicationClaim` 保持 `false`。Compactor 决策是 `keep-pi-native`。**

本次在 HEAD `48578bef9a67aab55102831853b116e1e6fcefb6` 上，按 `docs/pi-context-compression-benchmark-spec/{16,17,29,30}` 与 v2 计划 `22-evaluation-v2.md` / `24-live-benchmark-runbook.md` / `30-final-acceptance.md` 能跑的入口做了对照。结果分层如下：

| 层 | 对照对象 | 样本 | 决策 | 可否当发布证据 |
|---|---|---|---|---|
| W1 合成 Early Net Value | A0 Pi Native vs A1/A2（W1 仍用 Native compaction） | 60 pair | `proceed-to-w2` | 否 |
| W2 合成 Compactor | B0=`synthetic-pi-native-like-summarizer` vs B1/B2 PCR | 100 pair | `proceed-to-semantic` | 否（B0 不是 live Native） |
| W2 live spec-smoke | B0 live `session.compact()` vs B1 PCR hook | 30 pair × 1 seed | **`keep-pi-native`** | 否 |
| 仓库 MVP Gate | 合成报告 + T33–T44 证据 | n/a | `stop-at-deterministic-slice` | 否 |
| 产品验收测试 | fallback / recovery / vertical / pack | 见 §4 | pack 已修复后 7/7 pass；仍不是 live Gate | 否 |

Live 30 对已完成且同切点 30/30。B1 指令覆盖 30/30、secret leak 0；Native tool-heavy leak 5/6。但：

1. Hard Gate 失败：live `scoreArm` 把 `recovered` **写死为 `false`**，`exactEvidenceRecovery=0`。
2. Efficiency Gate 失败：probe 输入 token 相对 Δ **+2.41%**（规格要求 ≤ −15%），`realizedNetMedian=−11.5`（必须 > 0）。
3. 样本量 30×1，低于规格发布地板 **100 pair × 3 seed**。
4. 因此 **没有启动** `PCR_W2_LIVE_PROFILE=gate` 的 100 对 live。
5. 产品终验 pack 曾因 TS2846 失败；已修 `scripts/pack-smoke.mjs` rewriter 后重测 7/7 通过。这不改变 live W2 `keep-pi-native`。

---

## Run Identity

- Run ID: `pcr-vs-pi-native-2026-08-31`
- HEAD: `48578bef9a67aab55102831853b116e1e6fcefb6`
- 生成：2026-08-31（live 报告 `2026-08-31T07:39:09.991Z`）
- Node `v22.19.0` / pnpm `10.15.0` / Pi `@earendil-works/pi-coding-agent@0.84.4`
- 模型：`openclaw/Qwen3.8-27B-WORK`；`contextWindow=200192`、`maxTokens=16384` 未改（从 `~/.pi/agent/models.json` 原样拷贝）
- Cut policy（live 共享）：`keepRecentTokens=2048`，`reserveTokens=16384`，Native summarizer band `13107`
- W1 corpus lock：`tests/w1-gate/corpus.lock.json` major=1 sha256=`879da2d405cfc891390857d9a14de616f57a35c35a6b656a03842ceceb5a04cb` n=60
- `publicationClaim`: **false**

产物目录：`artifacts/runs/pcr-vs-pi-native/`。

## 规格要求 vs 实际入口

规格 `29-benchmark-runbook.md` 写的是：

```bash
pnpm benchmark:doctor / freeze / run / score / gate / verify
```

仓库 `package.json` **没有**这些 script。本次使用 PCR 已实现入口（这是仓库真源，不是规格命令）：

```bash
nvm use v22.19.0
pnpm w1:gate
pnpm w2:gate
PCR_W2_LIVE_PROFILE=spec-smoke pnpm vitest run --workspace vitest.live-paired-w2.workspace.ts
pnpm gate:mvp
```

未跑、因此不能声称完成的规格项：

- Publication profile（`configs/publication.json`：150+ boundaries、双 Reader、双 Judge、5 replicates）
- Live Lane 2 natural threshold（真实 200k 填窗直到自动 compact）
- Live Lane 3 provider overflow
- Live Lane 4 recursive long horizon
- B2 / proactive recall 的 live 臂
- Reader-isolated 独立 Reader 模型
- `PCR_RELEASE_GATE_BUNDLE` immutable 发布包
- 远端 `compatibility-required` CI（未 push）

## Method（比的是什么）

按 `30-pi-native-vs-pcr-comparison-protocol.md`：

- 不比两段摘要字符串相似度。
- 公平输入：同一 W1-shaped JSONL、同一 cut / `firstKeptEntryId`、同一 `tokensBefore`、同一模型与 `maxTokens`。
- 三层：artifact-only、reader-only、executor closed-loop。本次 live 把 probe 当 executor；没有独立 Reader 模型。
- LLM Judge 未启用，也不得裁定 hard gate。

W1 按 `16-w1-early-net-value-gate.md`：**W1 仍使用 Pi Native Compaction**，只证明 ingress / recovery / recall 增量。不能把 W1 token 收益记成 W2 compactor 收益。

W2 按 `17-w2-compactor-head-to-head-gate.md`：Hard → Reader → Closed-loop → Efficiency；Hard 失败则 `keep-pi-native`，即使摘要更短。

---

## 1. W1 Early Net Value（合成，本 SHA 重跑）

入口：`pnpm w1:gate` → `artifacts/runs/pcr-vs-pi-native/w1-synthetic/`。

- Arms：A0 Pi Native；A1 Native+W1 recall off；A2 recall on。
- 配额：60 = tool-heavy 20 / delayed-constraint 20 / recall-needed 10 / recall-not-needed 10；CJK 22、fail-fix-verify 20、malicious 15。符合 §3。
- Integrity：`exact_blob_recovery=1`，`cross_scope_leak=0`，`hard_constraint_violation=0`，`tool_pair_violation=0`（合成 runner 的 tool-pair 仍是常量 0）。
- Ingress：tool-heavy median Δ **−73.9%**；CI upper **−65.1%** ≤ −10%；`hookP95Ms=8.70` ≤ 75ms。
- Recall：Recall@5 / precision / silence = 1；needed success Δ = 1。
- Economics：`realizedNetMedian=1422.5`，CI [238, 2609.5]，50/60 对净值为正。
- Quality A1 vs A0 CI = 0（合成质量打分两边相同）。
- **Decision：`proceed-to-w2`，`hardGatePass=true`，`publicationClaim=false`。**
- `compaction: pi-native-not-replaced`。

报告字段 digest：`224685b2575e89c393e60e7fd4528ab4ddcbb1c2d69ce7fe268692c1f4b85696`。

冻结对照：tracked `artifacts/runs/w1-synthetic/report.json` 仍是冻回值 `hookP95Ms=33.45799554999991` / `reportDigest=01713017df65fc44a9c81deca93d17c88088569a852ca02ceb80e11e96266a1d`。Gate 重跑会改 P95 噪声，故对比快照与 freeze 分开存放。两者决策同为 `proceed-to-w2`。

W1 通过只允许继续 W2，**不是** PCR 替换 Native compact 的证明。

## 2. W2 Compactor（合成，本 SHA 重跑）

入口：`pnpm w2:gate` → `artifacts/runs/pcr-vs-pi-native/w2-synthetic/`。

- `livePiNative: false`
- `b0Kind: synthetic-pi-native-like-summarizer`（不是 Pi `session.compact()`）
- 100 pair / 5 family × 20；replicates 字段 3；lane `boundary-replay`
- Hard：directive 1、high-risk 0、tool-pair 0、must-omit 0、exact recovery 1、hash stable true → `hardGatePass=true`
- Token median Δ **−61.1%**；cost/success B0 491 vs B1 191（Δ −61.1%）；overflow recovery B0=0 B1=1；`realizedNetMedian=300`，100/100 为正
- Reader / closed-loop CI 均为 0（合成打分两边相同）
- **Decision：`proceed-to-semantic`，`publicationClaim=false`。**
- 报告 digest：`2655f7d20a3e8c0270704d963e00c17a447abade92aa3ca8f8fe6be62e6d8891`

这只证明 PCR checkpoint **相对合成 Native-like summarizer** 过了仓库 W2 scorer。规格 §2 要求的 B0 是 **Pi Native summary + retained tail**。合成过 Gate **不得**外推到 live Native。

## 3. W2 Live spec-smoke（本 SHA，真实 Pi Native compact）

入口：`PCR_W2_LIVE_PROFILE=spec-smoke`，435s，vitest 1/1 通过（断言只检查写出 live 报告且 `publicationClaim=false`，**不是** adopt PCR）。

产物：`artifacts/runs/pcr-vs-pi-native/w2-live-spec-smoke/`  
`reportHash=09c059ac18402509016dbd528fa7700a17d966414c2e67e3feef43af4be5d986`

### Sample Integrity

- Expected / completed：30/30
- Arm failures：0
- Same cut / 同 `firstKeptEntryId`：30/30
- Efficiency-eligible（Native 未超 13107×1.05）：30/30
- Replicates：1（规格 closed-loop 要 3 seed）
- B2：未跑
- Compact path：manual `session.compact()`，不是 200k threshold

### Integrity and Security

| Check | B0 Native | B1 PCR | Gate 用法 |
|---|---:|---:|---|
| `fromHook` | 0/30 | 30/30 | 两边都必须成立 |
| Hard directive coverage | 29/30 | **30/30** | B1 必须 1.00 |
| Must-omit leak | **5/30**（tool-heavy 5/6） | **0/30** | B1 必须 0 |
| Unsupported high-risk | 0 | 0 | B1 |
| Tool-pair violation | 0（常量） | 0（常量） | 未实测 tool pair |
| Exact evidence recovery | 0/30 | **0/30** | B1 必须 1.00 |

Hard Gate **失败**。失败条件是 `exactEvidenceRecovery !== 1`。  
真源：`tests/live-gate/paired-w2-live.ts` `scoreArm()` 第 228 行 `recovered: false`（成功路径与 catch 路径都是 false）。Live 配对 **当前实现下 Hard Gate 不可能过**，因为没有对 CAS blob 做 `readEvidenceById`。这是评分缺口，不是 30 对里偶然失败。

Artifact 层可观察的对比（不构成 adopt）：

- PCR checkpoint 摘要中位 **117** token vs Native **400.5**（约 −71% 字符摘要）。
- PCR 未把 `sk-live-w2-omit-*` 写进可见摘要；Native 在 tool-heavy 5/6 泄露。
- PCR 指令覆盖 30/30，含 temporal-update（相对 2026-08-28 的 100 对 live 有改善，见附录）。

### Quality / Closed-loop

Closed-loop：B0 **30/30**，B1 **30/30**。约束违反 0/0。  
Paired bootstrap median Δ 全为 0，CI lower=0 ≥ −0.02，**若 Hard 通过则非劣会过**。  
评分污染仍在：`honors` 在 summary 或 probe 任一命中即可；temporal oracle 仍用 `latestValue` 字符串。`09-w2-live-report-reanalysis.md` 的批评仍然适用。

分族（closed-loop / quality mean / probe input mean / summary mean）：

| Family | B0 loop | B1 loop | B0 quality | B1 quality | B0 probe | B1 probe | B0 summary | B1 summary |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| tool-heavy | 6/6 | 6/6 | 0.96 | 1.00 | 649 | 622 | 486 | 118 |
| constraint | 6/6 | 6/6 | 1.00 | 1.00 | 519 | 490 | 408 | 116 |
| temporal-update | 6/6 | 6/6 | 1.00 | 1.00 | **463** | **876** | 381 | 145 |
| branch | 6/6 | 6/6 | 1.00 | 1.00 | 489 | 608 | 364 | 117 |
| overflow | 6/6 | 6/6 | 1.00 | 1.00 | 498 | 496 | 393 | 116 |

### Efficiency

Gate 用的是 **下一轮 probe input**，不是摘要长度（符合协议：更短文本不能单独过门）。

- Artifact summary median：Native 400.5 vs PCR 117
- Probe input median：Native **507** vs PCR **513.5**
- Token median relative Δ：**+0.0241**（B1 更差；规格要 ≤ −0.15）
- Cost/success Δ：**+0.0128**（规格要 ≤ −0.10）
- Realized net median：**−11.5**（必须 > 0）
- Overflow recovery：两边 6/6，不是 Native-beating overflow win
- Compact latency p50：Native **8444ms** vs PCR **1695ms**（PCR 确定性；Native 付 generateSummary）
- 17/30 对 B1 probe input > B0；主因是 temporal-update（中位 +429）以及个别 outlier（`th-00` 584→1119，`tu-09/10/11` ~450→1190，`br-00` 474→1119）

Efficiency **失败**。摘要更短没有变成下一轮输入更短。

### Gate Decision

- Decision：**`keep-pi-native`**
- Hard gate pass：**false**
- Publication claim：**false**
- 未启动 100 对 `gate` profile。

## 4. 产品 / 最终验收对照（`30-final-acceptance.md`）

两套 pack 测试必须分开。终验清单要的是 **acceptance** 那条（真实 `npm pack` + 下游 `tsc` + patched Pi 加载），不是 e2e 轻量加载。

**A. 终验 pack**

首次（15:32）：`tests/acceptance/packed-install.test.ts` 1 fail / 1 pass。  
`context-hook.d.ts` TS2846：pack rewriter 把 `.d.ts` 里的 `@pcr/contracts` 改成了另一个 `.d.ts`，而 `domainHash` 是值导入。日志：`product/packed-install-acceptance.log`。

修复：`scripts/pack-smoke.mjs` `rewriteWorkspaceImports` 对 `.js` 和 `.d.ts` 都保留 `.js` specifier（tsc 提示的写法），并同时检查 sibling `.d.ts` 存在。

重测（15:57，14.57s）：

```text
tests/acceptance/compaction-fallback.test.ts          pass
tests/acceptance/restart-branch-recovery.test.ts      pass
tests/acceptance/product-runtime-path.test.ts         2/2
tests/acceptance/w1-vertical.test.ts                  pass
tests/acceptance/packed-install.test.ts               2/2
→ 5 files / 7 tests pass
```

另：`tests/tasks/t06.test.ts` 9/9 pass。

**B. 轻量 / 发布制品测试（通过，15:35，5.02s）**

```text
tests/e2e/packed-install.test.ts                      pass
tests/release/deterministic-mvp-gate.test.ts          9/9
tests/release/package-artifact.test.ts                4/4
```

e2e packed-install **不**做下游 `tsc`，不能覆盖 A 的失败。

`pnpm gate:mvp`：

- decision: `stop-at-deterministic-slice`
- recommendation: `publish-deterministic-mvp-only`（脚本枚举名，**不是**授权 npm publish）
- `publicationClaim: false`
- knownConflicts: `w2-control-is-synthetic-not-live-native`、`w1-publication-claim-false`、`w2-publication-claim-false`
- `realizedNetValue=0`（因为 `publicationEligible=false`）；合成观测净值 300 被故意不计

对照计划终验清单：

| 终验项 | 本次状态 |
|---|---|
| 当前 commit required CI 全绿 | **未跑**全量 `pnpm check:all`；未 push，远端 CI 无此 SHA |
| clean npm pack + clean Pi install | **修复后通过**：`tests/acceptance/packed-install.test.ts` 2/2。首次失败见 pack 日志 |
| tool_result → CAS → exact read | `product-runtime-path` 通过 |
| user input → directive → checkpoint | `w1-vertical` / product-runtime-path 通过 |
| materializer 用实际 model limits | live 使用未改的 16384/200192；未单列 T25 重跑 |
| compaction reject → Native fallback | `compaction-fallback` 通过 |
| restart/branch recovery | 通过 |
| W1 locked Gate | 合成 `proceed-to-w2`，`publicationClaim=false` |
| W2 hard+quality 或明确保留 Native | **明确 `keep-pi-native`** |
| immutable run bundle | 无 `PCR_RELEASE_GATE_BUNDLE` |
| Semantic Beta | 不在范围；`semanticDefault=off` |

Findings：`findingctl list` 空；`taskctl next` = `none`。这只说明任务协议收口，**不是**算法过 live Gate。

## Failure Attribution

- **Compressor（live）**：checkpoint 摘要更短且不泄露 must-omit；但下一轮 probe 在 temporal-update / 部分 branch 膨胀，效率门失败。
- **Retriever**：live 未跑 B2 / proactive recall。
- **Reader**：无独立 Reader；probe 与 summary 并集评分。
- **Executor**：`--no-tools` 文本问答，不是带工具的 workspace 闭环。
- **Integrity scorer**：`recovered` 写死 false，live Hard Gate 被实现锁死。
- **Infrastructure**：本次 30/30 完成，无 infra exclusion。
- **Control arm**：合成 W2 的 B0 不是 live Native。
- **Pack / types**：首次失败是 rewriter 把 `.d.ts` 指到 `.d.ts`。已改为指向 `.js`；acceptance pack 重测通过。

## 不允许的读法

- 不得用 W1 −73.9% 或合成 W2 −61.1% 声称“PCR 比 Pi Native 压缩更好”。
- 不得用 PCR 摘要 117 vs Native 400 声称过了 Efficiency Gate。
- 不得用 vitest live 测试绿灯声称过了 W2 Gate（该测试不断言 `decision`）。
- 不得用 `gate:mvp` 的 `publish-deterministic-mvp-only` 去 npm publish。
- 不得用 `tests/e2e/packed-install.test.ts` 绿灯覆盖 `tests/acceptance/packed-install.test.ts`。后者已在 rewriter 修复后 2/2 通过。
- 不得把 2026-08-28 的 100 对结果当作本 SHA 的 Gate。

## 附录：2026-08-28 的 100 对 live（历史，非本 SHA）

路径：`artifacts/runs/w2-live-native/gate/`，Pi 0.84.3，`reportHash=5dad9974093f137873988984bbabd71e78f42ed19d2f8185d396eb61fce9b8d8`。

当时：100/100 same-cut；B1 directive 80/100（temporal-update 掉 `version=7-*`）；Native leak 19/100；closed-loop B0 71 / B1 80；token Δ −36.7%；realized net +194.5；决策同样 **`keep-pi-native`**。计划 `09-w2-live-report-reanalysis.md` 已指出 temporal oracle 不可满足、100 样本伪重复、闭环评分污染、`recovered=no leak`。那次也 **不是** publication W2。

相对那次，本 SHA 的 30 对 smoke：指令覆盖升到 30/30，leak 仍是 Native 有 / PCR 无，但效率从 −33% 变成 **+2.4%**，且 recovery 评分改为恒 false。趋势变化本身说明 **不能**沿用 8/28 数字。

## 下一步（若要按规格真正过 W2）

1. 给 live `scoreArm` 接真实 `readEvidenceById` / tool-pair / 确定性 hash 复跑，去掉常量。
2. 效率改用协议要求的 materialized input，并解释 temporal-update probe 膨胀（checkpoint 哈希/指针进入下一轮上下文）。
3. 修好后先 `spec-smoke` Hard+Efficiency 都过，再 `PCR_W2_LIVE_PROFILE=gate` 100 pair；仍差 3 seed 与 Lane 2–4。
4. 在 Hard 失败或净值非正时保持 `keep-pi-native` 与 `publicationClaim=false`。

未执行：`git push`、发布、100 对 live、200k/overflow/递归长程。
