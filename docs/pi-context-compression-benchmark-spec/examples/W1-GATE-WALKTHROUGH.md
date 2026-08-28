# W1 Gate 计算示例

> 该示例只演示算法，不代表真实运行结果。

## 1. 实验臂

- A0：Pi Native；
- A1：Pi Native + W1 Reducer/CAS；
- A2：A1 + Proactive Recall。

## 2. 一组 60 Pair 的聚合结果

```text
Integrity:
  exact_blob_recovery = 1.00
  cross_scope_leaks = 0
  hard_constraint_violations = 0
  tool_pair_violations = 0

Quality A1-A0:
  point = -0.006
  95% CI = [-0.021, +0.010]
  non-inferiority margin = 0.03

Ingress A1-A0:
  median token delta = -0.24
  95% CI = [-0.31, -0.12]
  P95 hook latency = 42 ms

Recall A2-A1:
  Recall@5 = 0.94
  precision = 0.81
  silence = 0.92
  recall-needed success delta = +0.05
  quality 95% CI lower = -0.004, margin = 0.01

Economics:
  paired median realized_net = +0.008 currency units/task
```

## 3. 机器判定

1. Integrity 全通过；
2. `-0.021 >= -0.03`，A1 对 A0 非劣；
3. `-24% <= -20%` 且 CI 上界 `-12% <= -10%`；
4. Hook P95 42 ms <= 75 ms；
5. Recall/Precision/Silence 达标，行为增量为正；
6. Realized Net 中位数为正。

输出：

```json
{
  "gate": "w1-early-net-value",
  "decision": "proceed-to-w2",
  "hardGatePass": true
}
```

## 4. 反例

若 A2 的 Recall@5 为 0.95，但 recall-needed task success delta 为 -0.03，则不能因为检索命中高而通过。正确决策最多是 `keep-reducers-only`。
