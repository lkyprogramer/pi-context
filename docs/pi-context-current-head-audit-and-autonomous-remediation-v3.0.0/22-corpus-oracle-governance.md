# Corpus 与 Oracle 治理

每个 Case 必须拥有：

```json
{
  "caseId": "...",
  "family": "...",
  "sourceWitnessSha256": "...",
  "traceSha256": "...",
  "oracleSha256": "...",
  "split": "dev|test|holdout",
  "mustKeep": [],
  "mustOmit": [],
  "exactEvidence": [],
  "expectedSideEffects": [],
  "forbiddenSideEffects": []
}
```

冻结后，Case 内容、Oracle、Scorer 同时进入 manifest；任何变化都产生新 corpus version。Synthetic 与 Real Trace 必须分别统计，不得混写为“真实语料”。
