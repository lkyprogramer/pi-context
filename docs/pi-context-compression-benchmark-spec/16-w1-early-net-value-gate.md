# W1 Early Net Value Gate

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. Gate 目标

证明以下最小组合值得继续：

```text
Raw Tool Result CAS
Deterministic Reducers
Evidence Admission
Exact/Literal/FTS Read/Search
Proactive Recall
```

W1 仍使用 Pi Native Compaction，因此 Gate 只证明 ingress/recovery/recall 的增量价值。

## 2. Arms

- A0 Pi Native；
- A1 Pi Native + W1，Proactive Recall off；
- A2 Pi Native + W1，Proactive Recall on。

## 3. Corpus 配额

60 个 paired boundaries：

- 20 tool-heavy（build/test/search/read 大输出）；
- 20 delayed-constraint/update（10/50/100 turns 分布）；
- 20 recall-needed/recall-not-needed 对半。

至少 1/3 含 CJK、1/3 含失败→修复→验证链、1/4 含恶意 Tool Output 指令。

## 4. Hard Gate

```text
exact_blob_recovery == 1.00
cross_scope_leak == 0
hard_constraint_violation == 0 on deterministic constraint suite
tool_pair_violation == 0
overall quality CI lower >= -0.03 vs A0
```

## 5. Value Gate

### Ingress（A1 vs A0）

```text
tool-heavy median input token reduction >= 20%
95% CI upper bound for relative token delta <= -10%
P95 reducer+CAS overhead <= configured 75 ms warm target
```

### Proactive Recall（A2 vs A1）

```text
Recall@5 >= 0.90
page precision >= 0.75
unneeded-turn silence >= 0.90
recall-needed task success point delta > 0
overall quality non-inferior with 0.01 recall-specific margin
```

### Economics

质量 Hard Gate 通过后，`realized_net` 的 paired median 必须大于 0，且 95% CI 不应显示明显负值。

## 6. 决策

- `proceed-to-w2`：所有 Hard Gate + Value Gate 通过；
- `keep-reducers-only`：Ingress 正值，Recall 失败；
- `keep-recovery-only`：恢复价值成立但 Token/质量净值不足；
- `stop`：Hard Gate 失败或整体质量劣于 margin；
- `repeat-after-infrastructure-fix`：仅允许预注册的外部故障。

## 7. 不允许的证明

- 只展示某个日志从 10,000 行缩到 100 行；
- 只让 Judge 说 A2 摘要更好；
- 用不同模型/seed/后续任务；
- 把 Recall 未触发的实例从分母删除；
- 把 W2 Materializer 收益提前记入 W1。
