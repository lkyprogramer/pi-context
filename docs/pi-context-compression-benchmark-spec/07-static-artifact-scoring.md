# 静态压缩产物评分

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 容量与经济指标

```text
visible_tokens
system_tokens / tool_schema_tokens / message_tokens
compression_ratio = visible_tokens / source_tokens
net_removed_tokens = source_tokens - visible_tokens
cache_eligible_prefix_tokens
cache_read_tokens / cache_write_tokens
artifact_generation_latency_ms
storage_bytes / blob_bytes
```

## 2. 结构指标

- message schema valid；
- last authenticated user preserved；
- tool call/result pairing；
- no orphan result；
- no duplicated active user request；
- no secret/reasoning leak；
- deterministic output hash across repeated runs。

## 3. Oracle Coverage

```text
mandatory_coverage = correct must-visible items / all must-visible items
recallable_index_coverage = addressable recallable items / all recallable items
polarity_accuracy
temporal_accuracy
supersession_accuracy
status_accuracy
contradiction_rate
stale_item_rate
unsupported_outcome_rate
must_omit_leak_rate
```

## 4. 精确值策略

路径、commit、UUID、端口、错误码、命令、数字、版本和 quoted user directives 使用 exact/canonical normalization；不得让 LLM Judge 判断。

## 5. 自由文本策略

对不在有限 Oracle 中的语义内容，只输出 `unscored_natural_language_segments`，交由 Reader/Closed-loop/Judge。静态评分不得伪造语义确定性。

## 6. 产物可比性

只有在以下条件相同才比较压缩率：

```text
source trace hash
cut boundary
retained tail definition
effective input budget
system/tool schema envelope
image inclusion policy
tokenizer revision
```
