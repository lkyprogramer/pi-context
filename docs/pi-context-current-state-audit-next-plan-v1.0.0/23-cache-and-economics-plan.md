# Cache 与经济性方案

## 三种指标分开

1. **容量**：完整序列化请求 token；
2. **账单**：uncached/cache-read/cache-write/output 分项价格；
3. **任务净值**：成功任务的成本、延迟和失败代价。

## realized net

```text
avoided_uncached_input_cost
+ avoided_cache_read_cost
+ avoided_overflow_retry_cost
+ avoided_frontend_latency_value
- checkpoint/summary generation cost
- cache rewrite cost
- recall cost
- additional tool/exploration cost
- task failure penalty
```

## Gate

- 只在相同 case/seed 双臂均完成时配对；
- 容量与费用各自报告；
- cluster bootstrap 95% CI；
- per-family 不能出现 safety-critical regression；
- 中位 realized net >0 且 lower CI ≥0；
- 另要求 input/cost per success 至少一项达到预注册最小改善。
