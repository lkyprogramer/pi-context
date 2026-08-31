# 审计范围与方法

## 已核验

- 当前 `main` HEAD、最近提交主题、仓库树；
- 默认 Extension、Composition Root、Core/Runtime/Storage/Benchmark 关键源码；
- EFFECT、COMPARISON、live report、gate-decision；
- 当前 GitHub Actions workflow、Ubuntu/macOS current artifacts；
- 最新目标架构、数据流、Materialization、Checkpoint、Evaluation、Statistics、Runbook、CI、Final Acceptance 文档；
- 已提交 temporal probe previews 的重新评分。

## 未执行

- 未重新调用 openclaw 模型；
- 未在本容器 clone/run 全仓库，因为 GitHub DNS 在容器不可解析；
- 未重跑 100×3、200K threshold、overflow、recursive；
- 未把 preview 重评分冒充正式新实验。

## 证据等级

| 等级 | 含义 |
|---|---|
| E1 | 当前固定 HEAD 源码/CI 原始日志 |
| E2 | 同一 run 的 JSON/manifest/response preview |
| E3 | 文档、Task evidence、Finding closure 声明 |
| I | 基于 E1/E2 的明确推断，需后续测试确认 |

本报告的发布阻断只使用 E1/E2；架构风险可使用标记为推断的 I。
