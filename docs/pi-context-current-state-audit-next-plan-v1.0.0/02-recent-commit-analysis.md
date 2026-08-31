# 最近提交综合分析

## 提交主线

1. **T00–T13：基础事实层**  
   baseline、CI、v2 package graph、contract、identity、Pi 0.84.4、pack、RuntimeSession、composition root、SQLite/CAS/Saga/user input。
2. **T14–T25：Ingress 与状态层**  
   tool_result、reducer、Evidence/FTS、Unicode clause、Directive/Temporal、Continuity、Search/Recall、Trust/Action Gate、W1 vertical。
3. **T26–T38：Materialization/Compaction/Recovery**  
   envelope、budget/cache、four-zone materializer、context hook、snapshot/checkpoint、Native fallback、lifecycle/recovery、boundedness、background/economics。
4. **T39–T54：Evaluation/Release**  
   corpus/oracle/trace、W1/W2 runners、F0、closed-loop、integrity scorer、cluster stats、performance/fault lanes、gate、CI、acceptance、pack、release。
5. **收口修复**  
   probe-only scoring、完整 correction、稳定 IDs、产品 Tool Result FTS、corpus lock、pack `.js` specifier、live comparison snapshot。

## 进步

- 旧版最严重的 fixture IDs、Tool Result 未接线、无 CAS/FTS、correction 只抓关键词、positional stitch、Native fallback 等问题均有真实代码回应。
- 已经具备继续完成产品闭环与严谨实验的基础，不建议推倒重写所有模块。

## 未被提交数量掩盖的问题

- 提交/Task `committed` 不能替代 current required CI；
- Finding `closed` 不能替代 end-to-end data source correctness；
- 新 Benchmark 类型/单元测试不能替代真实 Pi/model run；
- local pack 成功不能替代 clean CI install；
- 对照报告快照不是当前 HEAD 的全量验收。
