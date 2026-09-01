# 统计与 Gate 规范

## 统计单位

- Raw pair：同一个 Case/Replicate 的 B0 vs B1/B2；
- Cluster：同一根任务/模板/轨迹 lineage；
- Replicate：真实独立模型采样或明确的 repeated call；
- Environment：Provider、模型、Node、OS、Pi、Extension、price table。

## 连续指标

使用 cluster bootstrap（≥10,000 draws）报告：estimate、95% CI、clusters、pairs。主指标预注册，不根据结果挑选 median/mean。

## 二元指标

报告 paired contingency：both pass、baseline only、candidate only、both fail；用 McNemar/cluster-aware bootstrap。关键安全项不做平均容忍。

## 多重比较

- 一个 primary quality endpoint；
- 一个 primary economic endpoint；
- family 指标为 guardrail；
- 多配置 ablation 做 Holm 校正或明确 exploratory。

## Gate 顺序

```text
Run identity/integrity
→ Hard security/invariants
→ Quality non-inferiority
→ Efficiency/net value
→ Release policy
```

任何前置 Gate 失败，后续指标只能作为诊断，不能 adoption。

## Sample Floor

Early smoke 可以 10–30 clusters；Publication 至少 30 independent clusters×3 replicates，并根据 discordant rate 做 power review。不要把 100 个模板变体等价成 100 个 cluster。
