# run 证据解读

数据来源：`artifacts/local-eval/{review-qc-20260910,review-qc-20260911,review-qc-20260911-fold1}/`，由 `scripts/aggregate_runs.py` 聚合为 `evidence/run-aggregates.json`。三次 run 均：HEAD `7616f54e` + 未提交改动（`dirty=true`）、Pi 0.85.1、`openclaw/Qwen3.8-27B-WORK`、w64k（`contextWindow 65536`）、seed 打桩到 65%、thinking medium、`/metrics` 可用、unknown usage = 0。**它们是诊断数据，不是交付证据。**

## 三次 run 的差别

| run | 与前一次的 dist 差异 | 场景差异 | 结果特征 |
|---|---|---|---|
| 20260910 | — | witness 在 stub head 内（120 字符头部含判定值） | 16/16 vs 15/16；balanced 只回读 3 次却几乎全过 → 泄漏 |
| 20260911 | 无（`distFiles` 相同） | seeds 加 `STUB_HEAD_PREAMBLE`，witness 移出 stub head | 回读 14 次/校验 12 次；fold 发生在第 2 请求 |
| 20260911-fold1 | `plugin.js`、`projection/witness.js` | 无 | fold 发生在第 1 请求（resume 前折叠） |

## Q lane 聚合（16 vs 16 episode）

| run | 通过 n/b | 请求数 n/b | Σfresh input n→b | ΣcacheRead n→b | wall 总 n→b | native compaction n/b | 回读/校验 (b) |
|---|---|---|---|---|---|---|---|
| 20260910 | 16/15 | 119/108 | 810k→858k (+6.0%) | 4.43M→0.65M (−85%) | 825s→633s (−23%) | 3/0 | 3/3 |
| 20260911 | 14/15 | 122/129 | 840k→890k (+5.9%) | 4.48M→0.97M (−78%) | 802s→730s (−8.9%) | 3/0 | 14/12 |
| 20260911-fold1 | 15/15 | 123/137 | 842k→301k (−64%) | 4.46M→1.96M (−56%) | 791s→556s (−30%) | 4/0 | 18/16 |

## 逐请求序列揭示的机制

Q01 balanced，20260911（warm 折叠）：

```text
(input 45078, cacheRead 0)   ← 冷预填 seed，与 native 相同
(input  4630, cacheRead 0)   ← fold 生效，前缀失效；但上下文只剩 ~5k，所以重填只有 4.6k
(input  3835, cacheRead 4939)
(input   563, cacheRead 8772)
```

Q01 native，同 run：

```text
(input 44945, cacheRead 0)
(input   221, cacheRead 45000)
(input    29, cacheRead 45729)
(input   437, cacheRead 45756)
```

Q01 balanced，fold1（冷折叠）：

```text
(input 11426, cacheRead 0)   ← seed 已被折叠，冷预填 11k 而非 45k
(input   154, cacheRead 11505)
```

Q03 native 的一次 compaction：

```text
(input  6010, cacheRead 0, purpose compaction)  ← 摘要生成
(input 24021, cacheRead 0)                      ← 压缩后冷重填
```

结论：

1. 折叠的代价 = 一次前缀失效 + 折叠后尾巴的重填（本轮 ≈4–5k），**不是**重填 60k。
2. warm 折叠对 fresh input 无收益（+6%），对 cacheRead/KV 体积收益 −78%，wall −9%。
3. 冷折叠（resume）直接少预填 ≈33k；这是 fold1 −64% 的全部来源。
4. native compaction 一次 ≈30k 冷 token + 摘要生成；balanced 三次 run 均为 0 次。这是"推迟 lossy compaction"论点的首份实证，但样本 3–4 次。

## 质量

- 三次 run 配对成功率差：−0.0625 / +0.0625 / 0。
- 不一致 pair（fold1）：Q05 r1 native 败/候选胜；Q05 r2 候选败（`historyReads=0`）/native 胜。
- 20260911：Q02 r2 native 败（无 compaction），Q05 r1 native 败（无 compaction）；即 native 的失败也不全由压缩造成，任务对该模型本身有 ~10% 抖动。
- 0 错误动作、0 折叠 isError、C01/C02 全部通过（多页 UTF-8 回读与跨分支检索）。

## 报告与 gate 的机械缺口（可用现有 run 离线复现）

对任一 run 目录执行 `node eval/local/report.mjs --run <dir>`：

- `decision.reason` 只有一句 `required evidence failed or unmeasured`，不含 pair。
- `decision.firstAttemptSuccess/finalAttemptSuccess` 为 null。
- `candidates: none`，尽管 Q05/balanced/r2 满足 `fold-time-model-hint` 单样本。
- 报告头 `plugin 34dfcba7da19` 三次相同。
- 尾注仍写 w262k。

S02–S04 完成后，同一命令在这三个目录上必须给出：`objective.freshInput.relativeChange` ≈ +0.060 / +0.059 / −0.642，`discordant` 列出上述 pair，`candidates` 含 `fold-time-model-hint (1/2, below gate)`。这是 S02–S04 的离线验收基准。
