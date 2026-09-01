# W2 — Materialization、Recall 与 Cache Economics

完整 I_eff，主动召回/租约，Provider cache usage，递归状态。

## Task DAG

- `B16` 接入完整 Serialized Envelope 与 I_eff — depends: B11
- `B17` 把 Proactive Recall、Lease、Directory 接入 Materializer — depends: B11, B16
- `B18` 接入 Provider Usage/Prompt Cache/Cost Telemetry — depends: B16
- `B19` 真实 Provider Cache Layout 与 Metadata Ablation — depends: B17, B18
- `B20` 递归状态、外部副作用与 Restart Continuation — depends: B12, B13, B17

## Exit Gate

- 所有 Task Evidence v2 验证通过；
- Findings 关闭有当前 HEAD 证据；
- Full Gate 干净重跑；
- 不以 synthetic component 代替 product/live acceptance。
