# pi-context 6.1：当前实现审计与精简修订计划

审计日：2026-09-09（Asia/Singapore）。代码基线 `7478307ead72e849e9c619a913858afe8a06d38b`。
这是审计文档第7轮交付，不是要求创建一个“v7产品”。继续维护现有6.1单插件、官方Pi0.85.1，不重建旧PCR、DSH或Posthorse fork。

**结论：保留Native-first；observe继续默认。balanced还应是明确的调试选项，当前资料不足以据此推荐普遍试用，更不能宣布优于Native。** 本轮最有价值的进步是正常源码/打包恢复、字段Hash统一、SQL作用域过滤、图片回读和原生压缩所有权；新的阻断项是活动视图边界、分页端到端可用性、评测判定与凭据隔离。

## 阅读路径

[审计结论](audit/00-verdict.md) → [源码问题](audit/03-findings.md) → [报告证据与口径](audit/04-report.md) → [修订设计](design/00-target.md) → [AI入口](AI-START-HERE.md)。

[上一版N01–N12复核](audit/02-compliance.md) · [来源和增量](audit/01-scope.md) · [CI与安全](audit/05-ci-security.md) · [完整任务](tasks/README.md) · [测试协议](testing/00-protocol.md) · [运行手册](testing/01-runbook.md) · [计量合同](testing/03-accounting.md)。

## 包含与不包含

包含实际源码隔离探针结果、修复任务、当前项目自报结果的独立登记、测试场景、离线审计工具、完整性校验。**不包含已实现的修复、不包含新模型成绩、不包含真实API Key、私有会话原文或隐藏思考块。** `evidence/source-probes.json`中的反例是人为构造后执行当前实现所得；它们不是37次Live实验的重新评分。

当前源包：9,868个文件；按Git blob/tree算法重建为 `728f66fabfafb41a3178761ee581cef8b3d153d3`，与远端main吻合。最新Live `20260909-112407` 的原始run目录没有出现在本次源码归档，因此无法复算该run的逐请求成本与配对质量。

## 工作量边界

10个任务。日常仅定向测试和类型检查；阶段集中一次真实宿主smoke；最终最多36个模型episode。没有taskctl、强制worktree、任务级全量Gate、跨平台巨型矩阵或默认语义后台。先完成安全与正确性任务，再开本地Provider实验。
