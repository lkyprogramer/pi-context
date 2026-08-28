# Benchmark 与行为评估

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

比较 Pi Native、billion-context-pi 类基线和 PCR 各阶段，使用闭环任务成功而非只看压缩率。

## 2. 已冻结决策

- 相同任务/seed/environment 进行 paired comparison。
- 报告 bootstrap 95% CI 与 non-inferiority margin。
- 压缩边界做 before/after paired continuation。
- 分离 memory/retrieval/reader/executor failure。

## 3. Baselines

1. Pi native compaction；
2. Pi native + deterministic tool reducer；
3. billion-context-pi（兼容版本）；
4. PCR deterministic-only；
5. PCR + claims/continuity/recall；
6. PCR + semantic/background。

## 4. Workloads

- 真实脱敏 coding trajectories；
- LongMemEval temporal/update/abstention 子集；
- ToolHaystack long tool interactions；
- MemGym coding/tool dialogue；
- synthetic constraints at 10/50/100 turns；
- branch/side-effect/recovery scenarios。

## 5. Metrics

任务：pass@1、resume correctness、constraint recall、outcome precision、time/update/polarity F1、abstention。  
行为：重复工具、重复读、blocked action、已完成重做、过早终止。  
效率：active tokens、input/output/cache tokens、P50/P95 latency、cost/success。  
记忆：retrieval rank、proactive precision、lease token-turns、silent when unnecessary。  
系统：replay divergence、orphan operation、branch leak、secret leak。

## 6. Early Kill Gate

在 Claims/Semantic 之前，先比较 `raw CAS + reducer + exact recall + materializer + host checkpoint`。若 task-adjusted net value 非正，停止扩大系统。

## 7. 不变量

1. 社区项目自报数字不作为 PCR 发布结论。
2. 任务质量下降不能以 token savings 抵消。

## 8. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 9. 关联资料

- `40-release-gates.md`
- `tasks/T42-benchmark-harness.md`
