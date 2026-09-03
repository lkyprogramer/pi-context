# 源码与 19 个提交增量分析

## 真实完成的改造

### W0：证据真值

- W1 Economic Gate 不再直接依赖 CI wall-clock；
- 测试 Lane 拆分；
- Evidence v2 拒绝空壳；
- False-done 任务重开；
- Raw run bundle 与 publication fail-closed 规则加入。

### W1：Runtime 所有权和持久化

- User/Tool Ingress 进入 `RuntimeSession`；
- Session cursor/shutdown 从全局迁向 session scope；
- Materialize/Compact 共用 `assembleRuntimeSnapshot`；
- `compaction_stage` 持久化并支持 ack/reconcile；
- Unpaired Tool/Broken Tail 进入 hard-stop；
- Semantic background 默认关闭。

### W2：Materialization 与经济学

- System Prompt、工具 Schema 进入 I_eff；
- Directory/Recall Page/Lease Warning 可注入；
- Usage 与 viewId 绑定；
- Superseded Directive 跨 compact 保留；
- B1 Identity 和 B2 PCR Materializer 拆分。

### W3/W4：Evaluation

- Probe-only scoring；
- CAS bytes/hash/length/wrong-cursor exact recovery；
- JSONL tool pair 真实计数；
- Per-arm isolated home/workspace；
- tools-enabled live；
- raw arm artifacts；
- Natural/Overflow/Recursive/Publication 均改为 fail-closed；
- Live runner 支持断点续跑和事件 cursor。

## 新回归

改造同时引入了 strict TypeScript 错误、packed build 回归、全部 compatibility 失败和大量 raw artifact 入库。说明开发过程在“功能接线”后没有把 `typecheck + pack + compatibility` 作为同一提交的不可分割完成条件。
