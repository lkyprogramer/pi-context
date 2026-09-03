# 统计与 Gate 规范

## Planned Denominator

所有报告同时输出 `planned/attempted/completed/scored/failed/retried`。主质量结论使用 planned denominator。

## 非劣与收益

- 关键完整性：绝对硬门，不做平均抵消；
- 任务成功：B2 相对 B0 的 cluster bootstrap 置信区间；
- Token/Cost：只在任务成功且硬门通过的 pair 上报告，同时给全样本敏感性；
- Latency：p50/p95/p99，区分 host、materialize、compact、provider；
- Recall：needed recall 与 no-recall 分开算 precision/recall；
- Cache：hit/read/write/rewrite 和货币折扣分开。

## Timeout

仅预注册 transport retry；模型不回答、工具死循环、进程未退出都算产品失败。Publication 不允许静默删除失败 pair。
