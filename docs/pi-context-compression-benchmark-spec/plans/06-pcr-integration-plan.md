# 集成现有 PCR Roadmap 的计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 修改建议

- 在 PCR W0 增加 Benchmark Contracts/RawTrace/Snapshot/Oracle；
- 将原 W1 Early Gate 替换为本包 B01–B17 的 W1 子图；
- 原 T42 改为消费本包闭环 Harness，而不是重新定义评测；
- 原 T45 只消费 `gate-decision.json`，禁止自行解释指标；
- W1 决策为 `stop` 时，不得开始 Claim/Semantic Wave；
- `keep-reducers-only` 时允许发布入口降噪子产品，但不宣称完整 Context Runtime 可行。
