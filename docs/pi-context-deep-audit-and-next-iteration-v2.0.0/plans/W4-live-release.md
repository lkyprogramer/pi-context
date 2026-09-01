# W4 — Long-horizon Live 与 Release

真实 Threshold、Overflow、Recursive；CI/Protection/Publication Gate 收口。

## Task DAG

- `B29` 完成真实 Natural 200K Threshold Lane — depends: B16, B24, B27
- `B30` 完成真实 Provider Overflow 与 Recursive Long-horizon Lane — depends: B20, B24, B27
- `B31` 统一 CI、Publication Gate 与 Release Claim Policy — depends: B01, B05, B06, B28, B29, B30

## Exit Gate

- 所有 Task Evidence v2 验证通过；
- Findings 关闭有当前 HEAD 证据；
- Full Gate 干净重跑；
- 不以 synthetic component 代替 product/live acceptance。
