# Token、延迟、Prompt Cache 与成本

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 计量面

每个请求记录：

```text
raw_active_tokens
materialized_tokens
system/tool/message/recall section tokens
provider input/output/cacheRead/cacheWrite
context hook wall/cpu time
reducer/CAS/FTS latency
compaction latency
storage and network bytes
provider price snapshot/version
```

## 2. Token 节省

使用 paired relative delta：

```text
delta_i = (new_i - baseline_i) / baseline_i
```

报告中位数、P90、bootstrap 95% CI，并按 tool-heavy、constraint、recall、branch 分层。

## 3. Cache 经济性

不能只看输入 Token。计算：

```text
input_cost = uncached_input * price_uncached
           + cache_write * price_write
           + cache_read * price_read
```

另外记录：

```text
eligible_prefix_tokens
first_different_section
prefix_reuse_ratio
```

## 4. Latency

- Hook 延迟不含 Provider 生成；
- Compaction Pause 单独统计；
- warm/cold、SQLite cache hit/miss、CAS hit/miss 分开；
- Pi 在 Context Hook 前的 full-message structuredClone 成本单独记录为 host overhead。

## 5. Realized Economic Net

在质量 Gate 通过后才计算：

```text
realized_net = avoided_provider_cost
             - recall_provider_cost
             - storage_compute_cost
             - background_waste_cost
             - configured_latency_cost
```

质量下降不折算成可被 Token 节省抵消的美元项。
