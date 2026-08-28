# Tool Result 可恢复性评测

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. Hard Gate

任何声明“完整原文保留在 CAS”的 Tool Result，必须满足逐字恢复和哈希一致：

```text
sha256(recovered_bytes) == raw_trace.tool_result.sha256
length(recovered_bytes) == raw_length
```

## 2. 测试矩阵

- ASCII/CJK/emoji/CRLF；
- binary-like/invalid UTF-8 policy；
- image refs；
- 0 byte、超大、并发和重复 toolCallId；
- reducer success/failure/timeout；
- crash at prepare/blob/receipt/host commit；
- key rotation；
- workspace/session/branch isolation；
- secret scrub only in visible view, not silent corruption of encrypted raw evidence。

## 3. 评分

```text
recoverable_claimed_count
exact_recovery_success_count
hash_mismatch_count
missing_blob_count
wrong_scope_denial_count
cross_scope_leak_count
recovery_latency_p50/p95
```

Gate：`hash_mismatch = 0`、`missing_blob = 0`、`cross_scope_leak = 0`，并且被访问控制拒绝的跨 scope 请求不能计作恢复失败。

## 4. Pi Native 对照

Pi Native 无 PCR CAS 时只报告其自身 Session/CompactionEntry 能否定位原消息，不把“原 Session JSONL 仍存在”错误等同于模型可通过公开 Tool 逐字恢复。
