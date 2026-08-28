# 参考算法、归一化与评分公式

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 设计原则

本章给出可直接实现的参考算法。它们是 **评测定义**，不是某个压缩器的实现。所有实验臂必须经过相同归一化和评分函数；任何 Arm-specific 评分分支都属于协议违规。

## 2. Token 与相对变化

对场景 `i`：

```text
relative_delta_i = (candidate_i - baseline_i) / max(baseline_i, 1)
compression_ratio_i = visible_tokens_i / max(source_tokens_i, 1)
reduction_ratio_i = 1 - compression_ratio_i
```

汇总报告 paired median，不使用 `ratio of means` 代替 `median of paired ratios`。

## 3. Oracle Item 匹配

### 3.1 Exact Value

路径、SHA、UUID、端口、版本、错误码、命令和数字使用类型化 normalizer：

```text
path      → POSIX separator + dot-segment collapse；不做 basename 匹配
sha/id    → lower-case；长度与字符集必须一致
number    → decimal canonical form；保留单位和比较符
command   → shell lexer token 序列；引号差异可归一，参数顺序不可随意改变
error     → Unicode NFC + ANSI strip + whitespace collapse
```

### 3.2 Polarity/Status/Time

每个 Oracle Item 的正确性是四个独立维度：

```text
value_match
polarity_match
status_match
valid_time_match
```

不得用文本中“出现过相同实体”代替四维正确性。

### 3.3 Coverage

```text
mandatory_coverage = correct(must-visible) / count(must-visible)
recallable_coverage = addressable(recallable) / count(recallable)
must_omit_leak_rate = leaked(must-omit) / count(must-omit)
```

空分母的指标返回 `null`，不得伪造为 1.0；Gate 只在该场景族具有对应 Item 时聚合。

## 4. Retrieval 指标

对每个 Recall-needed Query，相关集合为 `R_q`，排序结果为 `L_q`：

```text
Recall@k = |R_q ∩ top_k(L_q)| / |R_q|
Precision@k = |R_q ∩ top_k(L_q)| / k
MRR = 1 / rank(first relevant), 无相关命中为 0
nDCG@k = DCG@k / IDCG@k
```

Recall-not-needed Query 单独计算：

```text
silence_rate = no_injection_turns / all_not_needed_turns
false_injection_rate = 1 - silence_rate
```

## 5. Reader Ceiling

只有 Full-context Reader 答对的 Probe 才进入 Compressor Loss：

```text
eligible_p = full_context_correct_p == true
reader_retention = correct_candidate_on_eligible / count(eligible)
```

同时报告 `full_context_ceiling`，不得把低 Ceiling 数据隐藏。

## 6. Closed-loop 结果

Binary success 使用环境断言定义：

```text
success = all(required assertions pass)
          and forbidden_action_count == 0
          and hard_constraint_violation_count == 0
```

辅助行为指标：

```text
repeat_rate = repeated_tool_calls / max(all_tool_calls, 1)
blocked_action_rate = blocked_actions / max(action_attempts, 1)
steps_to_success
input_tokens_to_success
wall_time_to_success
```

## 7. Paired Bootstrap

对配对差值 `d_i = candidate_i - baseline_i`：

1. 用固定统计 seed 从 `N` 个 pair 有放回抽 `N` 个；
2. 每次计算目标统计量；
3. 重复 10,000 次；
4. 取 2.5%/97.5% percentile；
5. 原始 sample 与 CI 一起保存。

Binary success 另外输出 McNemar 表：

```text
both_pass / baseline_only / candidate_only / both_fail
```

## 8. 词典序 Gate

```text
if integrity_or_security_failed: FAIL
elif quality_noninferiority_failed: FAIL
elif recall_policy_failed: FAIL_OR_PARTIAL
elif efficiency_failed: PARTIAL_OR_STOP
else: PASS
```

不得把上述层级变成一个可被高压缩率抵消质量失败的加权分数。
