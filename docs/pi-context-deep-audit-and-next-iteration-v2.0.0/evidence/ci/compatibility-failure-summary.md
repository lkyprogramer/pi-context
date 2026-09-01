# 当前 Compatibility 失败摘要

- GitHub HEAD：`6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`
- Workflow：`compatibility`
- Run ID：`33478592798`
- 失败 Cell：Ubuntu / Node 24.18.1 / min Pi 0.84.4
- 结果：180 Test Files 通过，1 失败，1 skipped；818 Tests 通过，1 失败，1 skipped。
- 唯一失败：`tests/w1-gate/early-net-value.test.ts`
- 断言：期望 `proceed-to-w2`，实际 `keep-recovery-only`。

## 根因

该测试把经济/性能 Gate 放在 Unit Suite，并将真实运行时延参与 `hookP95Ms`。它在 Node 22 Required Lane 通过，在 Node 24 Compatibility Lane 失败，证明测试结论依赖运行环境而非纯业务输入。

## 修复原则

1. Unit Test 只验证纯函数与已知输入输出；时间通过 fake clock/recorded samples 注入。
2. 性能与经济 Gate 进入独立 Benchmark Lane，报告区间与环境身份，不断言单次机器上的固定决策。
3. Release Gate 必须要求 `required-gate` 与 `compatibility-required` 同时成功。

原始日志：`evidence/ci/compat-ubuntu-node24-min-unit.log`。
