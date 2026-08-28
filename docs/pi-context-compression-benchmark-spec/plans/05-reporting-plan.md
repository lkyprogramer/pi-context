# 评分、统计与报告实施计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 数据流

```text
Immutable Arm Artifacts
 → Static/Recoverability/Recall/Reader/Continuation/Economics results
 → Paired statistics
 → JSON report
 → Lexicographic Gate Decision
 → Markdown/HTML visualization
```

## 原则

- 报告 JSON 是唯一结论源；
- 图表和 Markdown 由 JSON 自动生成；
- 任何人工注释作为独立 review note；
- 重评分创建新的 `scoringRevision`，不覆盖旧结果；
- Gate Engine 只读取报告和冻结配置，不能读取 Arm 名称以外的实现细节。
