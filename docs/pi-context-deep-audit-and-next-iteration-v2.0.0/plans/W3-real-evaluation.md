# W3 — Real Evaluation

Probe-only、CAS recovery、tools environment、B0/B1/B2/F0、真实 corpus 与权威 100×3。

## Task DAG

- `B21` 用 Probe-only Scorer 替换 Legacy scoreArm — depends: B17
- `B22` Live Runner 实测 Exact CAS Recovery 与 Cross-scope Denial — depends: B13, B21
- `B23` 启用真实 Tools 与 Tool-pair/Environment Scorer — depends: B13, B21
- `B24` 实现真实 B0/B1/B2/F0 Arm Runner — depends: B17, B22, B23
- `B25` 定义受控 Replicate 与 Arm 调度策略 — depends: B24
- `B26` 构建真实 A1-shaped Locked Corpus 与 Cluster Split — depends: B24
- `B27` 保存完整 Raw Provider/JSONL/Store/Workspace Evidence — depends: B07, B24
- `B28` 运行修复后权威 100×3 并独立复核 — depends: B21, B22, B23, B24, B25, B26, B27

## Exit Gate

- 所有 Task Evidence v2 验证通过；
- Findings 关闭有当前 HEAD 证据；
- Full Gate 干净重跑；
- 不以 synthetic component 代替 product/live acceptance。
