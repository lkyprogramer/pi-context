# 测试 Lane 与 CI Runbook

| Lane | 网络 | Provider | 目标 | Required |
|---|---|---|---|---|
| unit | 否 | 否 | pure logic | 是 |
| contract | 否 | fake host | Pi/API boundary | 是 |
| integration | 否 | fake | SQLite/CAS/Saga | 是 |
| acceptance | 否 | fake/packed fixture | product vertical | 是 |
| packed | 否 | local Pi fixture | tarball/clean home | 是 |
| compatibility | 否 | local matrix | Node/OS/Pi | 是 |
| live-smoke | 是 | target | 低成本链路 | 否，定时 |
| publication-live | 是 | target | 权威成对评测 | 发布必需 |

单个测试文件只属于一个 Lane。Performance 断言不得放进 unit；Live 数字不得在普通 PR 中隐式重跑。
