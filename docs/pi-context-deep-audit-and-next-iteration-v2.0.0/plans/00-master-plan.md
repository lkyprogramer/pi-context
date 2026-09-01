# 总实施计划

## 目标

将当前“真实模块 + 部分产品接线 + 不可信完成状态”收敛为：

```text
One RuntimeSession
+ Atomic Snapshot
+ Durable Compaction Ack
+ Full Materializer/Recall/Cache Economics
+ Real B0/B1/B2/F0 Evaluation
+ Successful Long-horizon Live Lanes
+ Verifiable Release Gate
```

## Waves

| Wave | Tasks | Exit Gate |
|---|---|---|
| W0 Truth/CI | B00–B07 | Required+Compatibility 基础绿；Task 状态可验证 |
| W1 Runtime | B08–B15 | 所有 Hook 唯一 Session；Ack/Recovery durable；多 scope 通过 |
| W2 Context/Economics | B16–B20 | 完整 I_eff、Recall/Lease、真实 cache cost、recursive state |
| W3 Evaluation | B21–B28 | 真 B0/B1/B2/F0、准确 scorer、post-fix 100×3 |
| W4 Live/Release | B29–B31 | Threshold/Overflow/Recursive 成功；全 CI 绿；Gate 可发布或保持 Native |

## Release 决策

即便 W4 完成，PCR 也只有在同一最终 Run 的 Hard、Quality、Efficiency 全部通过时才 adopt；否则项目成功状态是“保留 Pi Native + 使用 PCR Ingress/Recovery”。
