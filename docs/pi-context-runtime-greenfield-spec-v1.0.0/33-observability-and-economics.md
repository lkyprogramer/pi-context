# 可观测性、Prompt Cache 与 Realized Economics

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义不泄密的事件、容量、缓存、成本、质量和后台浪费指标。

## 2. 已冻结决策

- 容量、费用、延迟、质量分开报告。
- 每个 view 记录 eligible prefix、first difference、cache read/write。
- 成本以 successful task 为分母。
- 后台 stale/wasted cost 单独记录。
- Telemetry 使用 opaque IDs 和 bucketed sizes。

## 3. Core Metrics

```text
pcr_materialization_ms
pcr_materialized_tokens
pcr_eligible_prefix_tokens
pcr_cache_read_tokens / cache_write_tokens
pcr_host_active_messages
pcr_host_clone_probe_ms
pcr_observation_raw_bytes / visible_tokens
pcr_retrieval_hits / injected_tokens / lease_token_turns
pcr_compaction_tokens_before / after
pcr_candidate_ready_hit / stale / cost
pcr_recovery_operations
pcr_security_denials
pcr_task_success / total_cost
```

## 4. Realized Net Value

```text
avoided_input_cost
+ avoided_overflow_cost
+ avoided_retry_cost
- semantic_generation_cost
- cache_rewrite_cost
- recall_cost
- background_stale_cost
- quality_regression_cost
```

初始策略只用保守分桶，不在线自动学习。积累 paired failures 后才讨论 curator。

## 5. Privacy

路径、query、error text 只记录 hash/category/length；调试原文需要显式 local secure trace，默认关闭并有 TTL。

## 6. 不变量

1. 不得用 token savings 掩盖任务成功下降。
2. Cache hit ratio 是主指标和 release gate，不是附属图表。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `38-benchmark-evaluation.md`
- `schemas/telemetry-event.schema.json`
