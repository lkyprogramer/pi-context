# AI Agent Benchmark 实施任务

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


本目录包含 B01–B18。任务按照公共合同→输入冻结→实验臂→评分→闭环→统计→Gate→发布排列。AI Agent 必须先读 `EXECUTION-PROTOCOL.md`，再通过 `TASK-INDEX.json` 和 `task-graph.json` 选择 ready Task。

## 关键分界

- B01–B05：可复现 Pi Native 基线；
- B06/B08–B10/B12–B17：W1 Early Net Value；
- B07/B11–B17：W2 Compactor Head-to-head；
- B14：辅助 Judge，不在主依赖链中阻断 deterministic gate；
- B18：集成与发布。
