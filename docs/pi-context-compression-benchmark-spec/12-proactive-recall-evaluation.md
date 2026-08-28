# 主动 Recall 正收益评测

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 两类场景必须成对

- `recall-needed`：正确完成后续任务必须使用热区外证据；
- `recall-not-needed`：当前上下文已经充分，额外注入只会浪费或干扰。

## 2. Arms

```text
A1 reducers + exact store，proactive recall off
A2 reducers + exact store，proactive recall on
```

A1/A2 其他配置完全相同。

## 3. 检索指标

```text
Recall@1/5/10
MRR
nDCG@k
page_precision
oracle_evidence_coverage
stale_evidence_rate
conflicting_version_pair_rate
```

## 4. 注入策略指标

```text
needed_turn_injection_rate
unneeded_turn_silence_rate
repeat_injection_rate
injected_tokens
lease_token_turns
```

## 5. 行为净收益

在 `recall-needed` 子集：A2 的任务成功点估计必须高于 A1，且关键约束/事实错误减少。在 `recall-not-needed` 子集：A2 不能显著增加错误、延迟或 Token。

## 6. 初始 Gate

```text
recall_needed_recall_at_5 >= 0.90
page_precision >= 0.75
unneeded_turn_silence_rate >= 0.90
repeat_injection_rate <= 0.10
overall_quality_noninferior
recall_needed_success_delta > 0 as point estimate
```

这些是首轮工程阈值，不是已验证结果；Gate 配置允许基于 Pilot 通过 ADR 修订。
