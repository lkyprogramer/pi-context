# 总实施计划

## 关键路径

```text
W0 CI Truth
→ W1 One RuntimeSession
→ W2 Correct State/Recall
→ W3 Payload/Checkpoint Correctness
→ W4 Evaluation v3
→ W5 Live/Release Gates
→ optional W6 Semantic
```

## 任务总数

- Tasks：51
- Findings：42
- Waves：7

## 退出条件

### W0

当前 HEAD required CI 全绿，测试 hermetic，branch protection 生效。

### W1

Pi 全部 Hook 只经 RuntimeSession；Context/Compaction 使用同一 snapshot heads；restart recovery 有真实 action。

### W2

Temporal/Directive/Pointer/Recall/Scope hard tests 全通过；递归约束有机制性保证。

### W3

serialized payload token/cost/cache 可对账；Checkpoint hard verifier 全真实；Metadata ablation 选定布局。

### W4

真实 B0/B1/B2/F0、probe-only、reader、environment、integrity、cluster Gate、immutable bundle 完成。

### W5

Boundary/Natural/Overflow/Recursive/Fault/Performance lanes 完成；Gate v3 生成决策；Package matrix全绿。

### W6

非必需。只有 deterministic 证据正向才允许。

## 推荐并行度

- W0：3–4 agents；
- W1：2–3 agents，composition root 串行；
- W2：4 agents；
- W3：3 agents；
- W4：4 agents，但 Runner/Gate 合并前单线程 review；
- W5：环境 lanes 并行，统计/决策单一 owner；
- W6：2 agents。
