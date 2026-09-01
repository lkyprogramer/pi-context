# Live Lane 与报告质量

## 当前报告的优点

- 明确 `keep-pi-native`、`publicationClaim=false`；
- 区分真实 Endpoint 与 Hermetic Stub；
- 披露 100×3 Hard 失败；
- 披露 Natural Threshold 未触发；
- 披露 Provider Overflow 未观察到；
- 披露 Recursive 只完成一次 compact；
- 没有将合成 W2 Gate 数字冒充真 Native 对照。

这说明 Claim Discipline 是当前报告最强的部分。

## 当前报告的不足

### 1. Run Identity 不统一

报告 HEAD 是 `a6281b3`，仓库当前 HEAD 是 `6c5c5b5`。正文 300 对发生在 directive backfill 前；最后附录只说明修复后 smoke 通过。

### 2. Raw Evidence 不可随仓库复核

报告引用 `artifacts/runs/w2-live-native/gate/report.json`，但该目录被 gitignore。读者无法离线重算 300 对或检查异常样本。

### 3. 指标名称高估证据

`exactEvidenceRecovery` 实际是代理；`closed-loop` 是弱问答；`seeds` 是标签；`overflow family` 不是 Provider Overflow。

### 4. 不完整 Lane 被 Task 封为 Done

尝试失败本身是有价值信息，但它只能使任务状态变为 `blocked/inconclusive`，不能满足 A43–A45 验收。

## 报告评分

| 维度 | 分数 |
|---|---:|
| 事实披露/不夸大 | 9/10 |
| Run Identity | 5/10 |
| Raw Artifact 可复核 | 3/10 |
| Scorer Validity | 2/10 |
| 统计独立性 | 3/10 |
| 产品结论正确性 | 8/10 |

总体：报告的**结论比其评分器更可信**。原因是作者主动保持 `keep-pi-native`，而不是因为现有 Gate 已经严谨。
