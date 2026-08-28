# 现有 PCR Benchmark 规格缺口审计

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 已有内容的优点

现有 `38-benchmark-evaluation.md` 已经冻结了正确方向：相同任务/seed/environment 的 paired comparison、bootstrap 95% CI、non-inferiority、boundary-local paired continuation，以及 compressor/retrieval/reader/executor 的失败分解。

## 2. 实现阻断缺口

| 缺口 | 为什么 AI Agent 无法自行证明 |
|---|---|
| W1 实验臂未准确定义 | W1 没有 materializer/host compactor，无法直接生成“W1 摘要” |
| 无 Canonical Raw Trace | 各臂可能从不同的 Pi Session 或已被 Reducer 改写的历史出发 |
| 无 Boundary Snapshot | 文件系统、进程、Session Leaf、模型路由和缓存可能不同 |
| 无 Oracle Schema | `constraint recall` 没有机器可计算的预期对象 |
| 无自由文本评分边界 | Agent 可能错误使用 ROUGE/embedding 相似度代替正确性 |
| 无 Reader 隔离层 | 无法区分压缩器丢失和执行模型能力不足 |
| 无闭环环境断言 | 摘要“看起来不错”不能证明后续任务正确 |
| 无 Recall 对照 | 无法证明主动 Recall 是帮助而不是额外噪声 |
| 无统计配置 | “显著下降”“非劣”没有 margin、样本和 CI 规则 |
| 无 Gate 决策 Schema | AI Agent 可以选择性报告有利指标 |

## 3. Wave 定义冲突

原 Roadmap 将 W1 定义为 T09–T19：Input/Tool Capture、Reducers、Evidence、Exact/FTS、Proactive Recall。Materializer 与 Pi Compaction Takeover 位于 W2。因此下面这句话不能按字面执行：

```text
W1 直接与 Pi Native 比较两份压缩产物
```

正确拆分为：

```text
W1：比较同一 Raw Trace 在不同 ingress/recall 策略下的端到端净值
W2：比较同一 W1-shaped Active Context 在不同 compactor 下的压缩产物和续跑行为
```

## 4. 修订动作

本包提供：

- 2 个独立 Gate；
- 3 层评测；
- 2 组实验臂；
- 17 份 JSON Schema；
- 18 个 AI 可执行 Task；
- 机器可读报告与决策；
- 语料、运行、Judge、统计与发布检查表。
