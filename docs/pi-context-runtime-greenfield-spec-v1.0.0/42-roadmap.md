# 实施 Roadmap 与 Kill Criteria

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

把 48 个任务分成可独立验证的 Wave，并在增加复杂度前设置净值门。

## 2. 已冻结决策

- Wave 0 先证明 Pi API 和宿主成本。
- Wave 1 先交付 deterministic value slice。
- Wave 2 才建立 Claim/Continuity/Action Gate。
- Wave 3 才增加 Semantic/Background。
- 每个 Wave 有停止标准。

## 3. Waves

| Wave | Tasks | 可运行产物 |
|---|---|---|
| W0 Foundation | T01–T08 | scaffold、contracts、Pi harness、store/CAS/Saga |
| W1 Deterministic Value | T09–T19 | input/tool capture、reducers、evidence、exact/FTS/proactive recall |
| W2 State Runtime | T20–T33 | claims、continuity、budget、materializer、hooks、host compaction、lifecycle |
| W3 Semantic/Background | T34–T38 | candidate、proposal、verifier、fencing、telemetry |
| W4 Productization | T39–T44 | tools/UI/package/perf/benchmark/security/compat |
| W5 Release | T45–T48 | MVP/Beta gates、ops、final artifact |

## 4. Kill Criteria

- W0 证明 `context/tool_result/compaction` Hook 语义不稳定或无法兼容；
- W1 与 Pi Native 最佳简单基线相比净值非正；
- periodic Pi Compaction 无法控制 clone/message 增长；
- Directive hard pin 无法在可接受预算内工作；
- security/action gate 产生不可接受误阻断且无法由 policy 分层解决；
- background stale cost 长期超过收益。

Kill 不是失败：保留 W1 的 reducers/exact recall 作为独立有价值产品。

## 5. 不变量

1. 不得跳过 W1 smoke gate直接投入 Semantic。
2. 任务状态以 task graph 和 evidence 为准。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `plans/00-master-implementation-plan.md`
- `tasks/task-graph.json`
