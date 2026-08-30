# Evaluation v2：可证明的算法与产品验证

## 实验臂

### W1 Ingress

- A0: Pi Native untouched；
- A1: Pi Native + identical PCR ingress/CAS/reducers；
- A2: A1 + proactive recall。

### W2 Compactor

所有臂输入同一 A1-shaped trace：

- B0: Pi Native compaction；
- B1: PCR deterministic checkpoint；
- B2: PCR checkpoint + request materializer + exact recall。

### Ceiling

- F0: Full context Reader/Executor，在窗口允许的 boundary 上作为可答性 ceiling。

## 三层证据

1. deterministic artifact score；
2. isolated reader probes；
3. paired closed-loop workspace continuation。

LLM Judge 只做辅助定性，不覆盖 hard gate。

## 数据分割

- train：公开，可调规则；
- dev：公开结果，可调配置；
- locked-test：加密/CI secret，只有 runner 看到 oracle；
- real-traces：脱敏后按 task cluster 划分，禁止同模板跨 split。
