# 测试协议（第 8 轮）

继承第 7 轮协议的全部安全与计量条款（父进程 broker、`--network none`、随机 canary、Pi-disjoint usage、ITT 分母、不得调参、不得改 oracle）。以下为本轮修订与新增；冲突时以本文为准。

## 1. 分层

| 层 | 内容 | 何时跑 | 消耗 |
|---|---|---|---|
| G0 定向 | 任务卡列出的 Vitest 文件 + `pnpm typecheck` | 每任务 | 秒级 |
| G1 受控 | `run-matrix --mode controlled`（`after-fold-quality`、`balanced-wire`、`controlled-guards`、新增 `warm-fold-regime`）；`secure-preflight --canary`；`grader-isolation` Docker 测试 | S05、S06、S07 前置 | 分钟级，Docker |
| G2 live | 84 episode 矩阵 | 仅 S07 | 4090 ≈ 80–100 分钟 |

## 2. 矩阵

| lane | case | 臂 | reps | episode | 进入 |
|---|---|---|---|---|---|
| Q | Q01–Q08 | native, balanced | 3 | 48 | 主质量分母 24 pair；主目标 |
| C | C01, C02 | balanced | 3 | 6 | 能力分母 6 |
| W | W-Q01, W-Q03, W-Q05, W-Q07 | native, balanced | 3 | 24 | `regimes.warm`（12 pair） |
| X | X01 | native, balanced | 3 | 6 | `regimes.long`（3 pair） |
| 合计 | | | | 84 | |

顺序：`buildReviewPlan()` 生成，case 组由 `--seed 42` 打乱，同 rep 内先 native 后 balanced。冻结在 `eval/local/review-matrix.json`；manifest 记录其 hash。

## 3. 目标与判定

主目标 `fresh-input`（Σ `normalized.freshInput`），`minImprovement 0.1`，S02 冻结，S07 不可改。次要目标只报告。判定顺序与规则见 `design/00-target.md` §3；实现于 `evaluateTrial`；`report.md` 的 decision 段由结构化字段渲染。

不一致规则的边界：`b − c ≥ 2` 或某 case `b ≥ 2` → `review-needed`。3 rep 下，一个真实退化 1/3 的 case 在 24 pair 里被否决的概率仍不高；本轮接受这一点，因为 Q lane 的目的是"机制不伤质量"的下界检验，真正的质量差异要看 W/X lane 的 quote 失败计数。**不要用增加 rep 来追求显著性**——预算优先给 regime lane。

## 4. regime lane 的读数

- warm：`objective.primary.relativeChange` 预期区间 −0.05 ~ +0.10（fresh input 基本持平）；`cacheRead` 预期 ≤ −0.5；`nativeCompactions` 预期 native ≥ 0、candidate 0。若 warm 的 fresh-input 也 ≤ −0.1，说明 6.1 的会话中折叠本身有预填收益，`cold-aligned-fold` 候选不成立。
- long：native `nativeCompactions ≥ 1`（目标 2）；`quoteFailures.native` 与 `.candidate`；balanced `folds ≥ 3`。若 native `nativeCompactions = 0`，X01 `unexercised`，需在 S06 调 `lines` 后重跑（新 runId）。

## 5. 预算

| 项 | episode（Q/C/W） | episode（X01） | run |
|---|---|---|---|
| wall | 600 s | 900 s | 7200 s |
| 模型调用 | 24 | 40 | 1500 |
| 工具调用 | 48 | 80 | 2400 |

任一先到即停；`timeout` 的 episode `passed=false` 留分母；run 级到顶后剩余 `NOT_RUN`。

## 6. 证据与口径

- 三次旧 run（`review-qc-*`）是 dirty 诊断数据：报告头必须带 `DIAGNOSTIC ONLY`，任何文档只能在"诊断数据"小节引用，不得出现在决策句附近。
- 冷/暖口径必须分开写：Q lane 的 fresh-input 收益是 resume 冷启动收益；W lane 才是会话中收益。禁止把 Q lane 的 −64% 写成"日常节省"。
- 每个 episode 的 `requests.jsonl` 是终审依据；`report.md` 只是渲染。
- unknown usage 计数而不置零；`known:false` 的目标不参与裁决。

## 7. 安全

- agent 容器 `--network none`（Linux bind socket / Darwin named volume），grader 容器 `--network none` 且无 socket。
- Key 只存在于父进程内存（Linux）或 sidecar 进程内存（Darwin，经 stdin）；宿主与 episode 目录零 Key 文件。
- `secure-preflight --canary` 必须 `agentEgress:false`；`true` 即 BLOCKED，不允许回退。
- 泄漏断言只用随机 canary；报告与迭代记录不得含 NGINX token、SSH 口令、真实 Key；4090 只经 18343 隧道访问，不改机器配置。

## 8. 失败处理

- engine identity 变化 → episode `blocked`，继续；blocked > 20% → 停止，`inconclusive`。
- Docker/镜像缺失 → `BLOCKED`，不回退到宿主运行。
- 任务红测无法在错误行为上失败 → 不是有效红测，重写。
- 需要改 oracle 才能通过 → 停止，写入迭代记录，等待人工决定。
