# 实验臂与分阶段 Factorial 设计

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. Canonical Input

所有实验从同一个 `RawTrace` 开始，而不是从某一臂已经改写的 Pi Session 开始。RawTrace 保存未经过 Reducer 的用户消息、assistant 消息、tool call、完整 tool result、模型用量和 Workspace 边界。

## 2. W1 实验臂

| Arm | Ingress | Recall | Compactor | 用途 |
|---|---|---|---|---|
| A0 | Pass-through | 无 | Pi Native | 原始基线 |
| A1 | W1 CAS + Reducers | 手动 Exact 工具可用，不主动注入 | Pi Native | 隔离入口降噪价值 |
| A2 | W1 CAS + Reducers | Proactive Recall | Pi Native | 隔离主动召回增量 |

A0/A1/A2 都使用同一 Pi Native Compaction。W1 Gate 不能声称是在比较两个 compactor。

## 3. W2 Compactor-isolated 实验臂

先把 RawTrace 统一通过 W1 Ingress，形成同一 `W1ShapedTrace`，再比较：

| Arm | Input | Compactor | Request-time Materializer |
|---|---|---|---|
| B0 | 同一 W1ShapedTrace | Pi Native | 关闭 |
| B1 | 同一 W1ShapedTrace | PCR Deterministic Host Checkpoint | 关闭或固定为 identity |
| B2 | 同一 W1ShapedTrace | PCR Host Checkpoint | PCR Materializer |

B0/B1 是 compactor-only；B0/B2 是 runtime stack 增量。

## 4. End-to-end 实验

| Arm | 全栈 |
|---|---|
| E0 | Pi Native 原始路径 |
| E1 | W1 + Pi Native |
| E2 | PCR Deterministic Runtime |
| E3 | PCR Semantic Runtime（后续 Gate） |

End-to-end 结果用于产品决策，但不能单独归因某一个模块。

## 5. 控制变量

必须固定：

- RawTrace hash；
- Pi package version/commit；
- Node/OS；
- Workspace image/hash；
- Session Tree/Leaf；
- model/provider/api；
- temperature、seed、thinking level、max output；
- contextWindow、reserveTokens、keepRecentTokens；
- tool schemas 与版本；
- reducer/catalog/config revisions；
- Provider Session ID 隔离策略；
- Cache-on 与 Cache-off 运行模式。

## 6. 禁止的比较

- 用 A0 的已压缩 Session 再运行 A2；
- 不同切点或不同目标预算直接比较摘要长度；
- Pi Native 用较大模型、PCR 用较小模型；
- 一臂保留 Provider Cache，另一臂使用全新请求；
- 将社区项目 README 数字当作当前运行结果。
