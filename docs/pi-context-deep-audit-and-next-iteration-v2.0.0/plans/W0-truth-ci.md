# W0 — Evidence 与 CI Truth

修复 Compatibility、Lane、Task Evidence、Protection、Docs 与 Raw Bundle。

## Task DAG

- `B00` 冻结当前源码、CI、报告与审计证据 — depends: none
- `B01` 修复 W1 Gate 非确定性并恢复 Compatibility 全绿 — depends: B00
- `B02` 建立互斥测试 Lane 与语义命名 — depends: B00
- `B03` 强化 Task Evidence Schema 与 taskctl 验证 — depends: B00
- `B04` 重新审定 A00–A50 状态并重开未满足任务 — depends: B03
- `B05` 真实核验并配置 GitHub Branch Protection — depends: B01
- `B06` 统一 Handoff、Compatibility、Install、Package Policy — depends: B01
- `B07` 制定并实现不可变 Raw Run Bundle Policy — depends: B00, B03

## Exit Gate

- 所有 Task Evidence v2 验证通过；
- Findings 关闭有当前 HEAD 证据；
- Full Gate 干净重跑；
- 不以 synthetic component 代替 product/live acceptance。
