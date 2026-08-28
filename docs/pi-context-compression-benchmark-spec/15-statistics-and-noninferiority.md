# 统计、Non-inferiority 与样本规则

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. Paired 是硬要求

同一 Scenario/Boundary/Seed 在每个 Arm 都运行，统计单位是 paired difference，不是两个独立均值。

## 2. Binary Quality

```text
d_i = success_new_i - success_base_i
```

报告 paired bootstrap 95% CI；同时给 McNemar discordant pair 表。

默认非劣 margin：

```text
W1 early: delta_quality = 0.03
W2 compactor: delta_quality = 0.02
```

通过条件：`CI_lower(new - baseline) >= -delta_quality`。

## 3. Continuous Metrics

Token、成本、延迟和 steps 使用 paired bootstrap 10,000 次，报告 median relative delta 与 CI。重尾延迟不只报均值。

## 4. Sample Stages

| 阶段 | 最低规模 | 用途 |
|---|---:|---|
| unit/synthetic CI | 12 scenarios | 回归，不作产品结论 |
| smoke | 30 paired boundaries | 发现明显负值 |
| W1 gate | 60 paired boundaries，至少三类各 20 | Early decision |
| W2 gate | 100 paired boundaries | Compactor decision |
| publication | 150+，由 pilot power analysis 调整 | 对外结论 |

每个闭环 Boundary 至少 3 个 Executor seeds；静态评分不需要重复 seed。

## 5. 多重指标

采用层级 Gate，不做单一加权总分：

```text
Safety/Integrity → Quality → Recall behavior → Efficiency
```

只有同层多个探索指标需要 FDR 控制；Hard Gate 不做“多重比较后放宽”。

## 6. Missing/Failed Runs

运行失败按预注册规则分类。系统崩溃、超时和无法恢复是该 Arm 的失败，不能从分母删除。Provider 外部故障可标 `infrastructure-excluded`，必须在所有 Arm 同步重跑。
