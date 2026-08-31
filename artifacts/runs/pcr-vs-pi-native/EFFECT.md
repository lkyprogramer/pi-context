# 当前 PCR 插件 vs Pi Native compact：效果对照

HEAD `48578bef9a67aab55102831853b116e1e6fcefb6`  
Pi `@earendil-works/pi-coding-agent@0.84.4`  
模型 `openclaw/Qwen3.8-27B-WORK`（`contextWindow=200192`，`maxTokens=16384` 未改）  
时间 `2026-08-31T07:39:09.991Z`  
原始 JSON：`w2-live-spec-smoke/report.json`（hash `09c059ac18402509016dbd528fa7700a17d966414c2e67e3feef43af4be5d986`）

## 比的是什么

同一条冻结 session JSONL，同一 cut / `firstKeptEntryId` / `tokensBefore`，两个独立 Pi home：

| 臂 | 实际路径 |
|---|---|
| **Pi Native（B0）** | `pi --no-extensions`，RPC `session.compact()`，`fromHook=false` |
| **当前插件（B1）** | `pi -e apps/pi-context-runtime/dist/extension.js --no-extensions`，compaction hook 写出 deterministic checkpoint，`fromHook=true` |

30 对 / 5 族 × 6，全部完成，same-cut 30/30。这是 live Native compact，不是合成 summarizer。

**不是发布 Gate。** 规格要 100×3；Hard 因 `recovered` 写死 false 失败；下一轮 probe token 没有少 15%。决策：`keep-pi-native`，`publicationClaim=false`。

## 总表（中位数，n=30）

| 指标 | Pi Native | PCR 插件 | 差值 |
|---|---:|---:|---|
| compact 产物 token | **400.5** | **117** | −70.8% |
| 压缩后下一轮 probe input token | **507** | **513.5** | **+1.3%** |
| compact 延迟 p50 | **8444 ms** | **1695 ms** | −80% |
| compact 延迟 p95 | 10655 ms | 2717 ms | |
| must-omit 泄露 | **5/30** | **0/30** | PCR 不泄 tool-heavy secret |
| 硬指令覆盖 | 29/30 | **30/30** | |
| 压缩后问答闭环成功 | 30/30 | 30/30 | 平 |
| Gate 用的 token Δ | | | **+2.41%**（要 ≤ −15% 才过效率门） |
| realized net | | | **−11.5**（要 > 0） |

读法：插件写出的 checkpoint **比 Native 摘要短约 71%，也快约 5 倍**。但 compact 之后下一轮模型真正吃到的 input **没有变短**（中位还略高），所以规格 Efficiency Gate 判 Native 更好。泄露和指令覆盖是插件更好。

## 分族

| 族 | Native 摘要 | 插件摘要 | Native 下一轮 | 插件下一轮 | Native 延迟 | 插件延迟 | Native 泄密 | 闭环 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| tool-heavy | 489 | **118** | 658 | **522** | 10389 | 1653 | **5/6 vs 0** | 6/6 = 6/6 |
| constraint | 412 | **115** | 524 | **487** | 8366 | 1694 | 0 | 6/6 = 6/6 |
| temporal-update | 390 | **145** | **463** | **886** | 8102 | 1867 | 0 | 6/6 = 6/6 |
| branch | 367 | **117** | **484** | **510** | 8384 | 1687 | 0 | 6/6 = 6/6 |
| overflow | 383 | **115** | 485 | 491 | 8366 | 1634 | 0 | 6/6 = 6/6 |

下一轮变差的主因是 **temporal-update**：摘要仍更短（390→145），但 probe input 从 463 涨到 886。checkpoint 里的 hash / pointer / heads 进了下一轮上下文。

## 产物长什么样（各取一对）

同一 `th-00`：Native 是自然语言 Goal/Constraints 摘要（465 token，且 tool-heavy 族会把 secret 写进摘要）；插件是 `checkpoint v2 <hash>` + active prohibition 指针（117 token）。两边下一问都答「不能改 public API」。

同一 `tu-00`：Native 摘要仍像会话纪要；插件留下 `改为 version 7` 的 correction 指令。下一问 Native 答 `version=6 build=0`，插件答 `7`。闭环打分两边都算过，但答案质量不同。

## 和「合成 W2 过 Gate」的关系

`pnpm w2:gate` 的 `proceed-to-semantic` 比的是 **假 Native-like summarizer**，token Δ −61%。  
上表才是 **真 Pi `session.compact()`**。两套数字不能混用。

W1 合成 `proceed-to-w2`（tool-heavy −73.9%）证明的是 CAS/reducer/recall，W1 压缩器仍是 Native，也不能记成插件 compact 收益。

## 原始文件

- 本对照：`artifacts/runs/pcr-vs-pi-native/EFFECT.md`
- Gate 全文：`artifacts/runs/pcr-vs-pi-native/COMPARISON.md`
- live JSON：`artifacts/runs/pcr-vs-pi-native/w2-live-spec-smoke/{report,gate-decision}.json`
