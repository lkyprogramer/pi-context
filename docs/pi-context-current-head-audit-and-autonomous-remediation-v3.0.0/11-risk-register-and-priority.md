# 风险登记与优先级

| 优先级 | 必须先解决 | 原因 |
|---|---|---|
| P0 | strict compile、packed install、compatibility | 当前无法形成候选包 |
| P0 | branch protection/verify fail-open | 红提交可进入 main |
| P0 | Gate B2 vs B0 | 当前评测没有回答产品采纳问题 |
| P0 | 300 planned 样本的 missingness | 280 完成可能有选择偏差 |
| P0 | overflow/recursive 声明边界 | 当前证据不支持恢复和自主长程 |
| P1 | lease persistence、provider usage provenance | 影响长期正确性与成本结论 |
| P1 | dual hash、run epoch | 影响证据可复算性 |
| P1 | raw artifact secret scan | 影响公开仓库安全 |
| P2 | artifact 存储从 Git 移到 Release/Actions | 影响长期维护成本 |

不要在 P0 关闭前继续扩大算法复杂度或打开 Semantic Beta。
