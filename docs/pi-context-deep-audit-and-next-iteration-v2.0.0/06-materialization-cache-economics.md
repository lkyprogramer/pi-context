# Materialization、Prompt Cache 与经济性

## 当前进步

`composition-root.ts:781-815` 已从 State Store 读取 active directives、claims、continuity 和 pointers，并把 directive/continuity/claim 送入 Materializer；Cache Receipt 也由内存数组改为持久 Store。

## 仍不完整的 RuntimeSnapshot

当前 Materializer Snapshot 未提供：

- bounded directory；
- proactive recall page；
- purpose-bound lease；
- continuity delta；
- runtime warnings；
- provider/tool-schema specific stable prefix。

因此 A21 的“Proactive Recall”目前是库能力，不是默认产品能力。

## I_eff 仍缺关键负载

产品只执行：

```ts
const reserves = reservesFromPayload({ imageBlocks });
```

没有把真实 system prompt、tools schema、routing/provider overhead、thinking/reasoning envelope 送入预算。由此产生两个风险：

1. 小 Context Window 或大 Tool Schema 下可能过度保留历史；
2. 当前 token/cost 报告无法和 Provider 实际 usage 对齐。

## Prompt Cache

当前 Receipt 能表示 section order 与 first-different，但没有真实 Provider：

- cacheRead tokens；
- cacheWrite tokens；
- hit ratio；
- prefix break location；
- 冷/热价格；
- stale background rewrite cost。

所以“下一轮 input 更短”不能直接推出“每成功任务更便宜”。后续必须按请求记录：

```text
uncached_input_cost + cache_write_cost + cache_read_cost
+ summary/recall/output cost + latency/failure penalty
```

并在相同质量通过后比较。
