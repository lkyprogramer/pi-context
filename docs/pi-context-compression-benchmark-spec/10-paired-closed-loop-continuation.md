# Paired Closed-loop Continuation

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 这是任务质量的主证据

TRACE 类 boundary-local 方法的核心是：从同一环境状态对每个压缩产物启动独立续跑，观察后续行为是否变得重复、阻塞或错误。

## 2. 运行流程

```text
freeze BoundarySnapshot
for each arm and replicate:
  restore isolated Pi home/workspace/runtime store
  replay arm-specific ingress to boundary
  apply arm compaction/materialization
  inject identical hidden continuation task
  run same executor model and tools
  collect full event/action trace
  run deterministic environment assertions
```

## 3. 质量指标

```text
task_success
constraint_violation
forbidden_action_count
blocked_action_count
repeated_tool_call_count
repeated_file_read_count
completed_step_redo_count
premature_termination
recovery_action_success
steps_to_success
tokens_to_success
wall_time_to_success
```

## 4. Cache 与质量实验分离

- `quality-mode`：每个 Arm 使用独立 Provider Session，禁止跨 Arm cache 污染；
- `economics-mode`：按真实生产连续会话测试 cache read/write；

两种模式分开报告，不用 Cache 命中差异解释质量差异。

## 5. 随机化与盲化

Arm 执行顺序随机；报告生成前用匿名 ID；环境评分器只接收动作/文件结果，不接收 Arm 名称。

## 6. 失败归因

| 阶段 | 判定 |
|---|---|
| Artifact 缺 Oracle Item | compressor failure |
| Artifact 有 Item，Reader Probe 错 | reader failure |
| Recall 索引无命中 | retrieval failure |
| Recall 命中但未注入/未使用 | policy/reader failure |
| Reader 正确但工具执行失败 | executor/tool/environment failure |

## 7. Overflow 场景

若 Full-context 同模型无法运行，不伪造 Full-context 对照；使用原始成功轨迹动作和环境结果为 Oracle，并把该实例标记为 `no-full-context-counterfactual`。
