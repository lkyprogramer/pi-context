# 三层主评测与一层辅助评审

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## L0：Static Artifact Evaluation

输入是 Canonical Raw Trace、Oracle 和某实验臂生成的可见上下文/Compaction Artifact。完全离线计算：容量、结构、字面量、Claim、恢复、检索、成本和确定性。

优点：便宜、可重复、能精确定位压缩器错误。局限：不能证明模型会正确使用产物。

## L1：Reader-isolated Evaluation

固定 Reader Model 只看到压缩产物，不允许工具调用，回答一组有确定答案的 Probe。另跑 Full-context Reader Ceiling。

```text
memory_retention_ratio = compressed_probe_accuracy / full_context_probe_accuracy
```

它隔离了“记忆表征是否足够”与“执行工具是否成功”。

## L2：Paired Closed-loop Continuation

从同一 Pi Session Leaf 和 Workspace Snapshot 分叉，每个实验臂收到相同后续任务、相同 Executor Model/参数和相同工具环境。最终由环境断言评分。

这是任务质量、重复行为、blocked action、禁止动作和主动 Recall 净价值的主证据。

## L3：Blind LLM-as-Judge（辅助）

仅用于因果链、可读性、摘要组织和未被 Oracle 覆盖的自然语言差异。必须盲化 Arm、要求引用 Source Refs，并由确定性 Gate 压制。

## 组合规则

```text
L0 硬失败 → 直接失败，不运行 Judge 覆盖
L0 通过 → L1 检查可读与可问答性
L1 通过/非劣 → L2 检查真实行为
L3 只用于解释、错误聚类和人工 Review 排序
```
