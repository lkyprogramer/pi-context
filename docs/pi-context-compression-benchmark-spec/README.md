# Pi 上下文压缩算法比较与 Early Net Value Gate 完整规格

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


本包补齐 `pi-context-runtime-greenfield-spec-v1.0.0` 中 Benchmark 规格的关键缺口：把“同一轨迹、同一边界、同一预算”落实为可执行的 **冻结输入、Oracle、实验臂、评分函数、闭环续跑、统计检验、LLM Judge 边界和机器可读 Gate**。

## 先读结论

1. **不是所有比较都需要另一个 LLM。** Token、延迟、缓存、结构完整性、精确字面量、Blob 恢复、Oracle Claim 覆盖、工具配对和环境断言可以直接由算法计算。
2. **任意自由文本摘要之间不能仅靠字符串算法证明语义等价。** ROUGE、BLEU、编辑距离和 embedding 相似度不能证明约束、否定、时间、状态和下一步行为被正确保留。
3. **任务质量必须以闭环续跑为主证据。** 从同一个 Pi Session/Workspace 边界分别运行各实验臂，继续执行同一个后续任务，用测试、文件哈希、禁止动作、外部副作用和最终任务断言评分。
4. **LLM-as-Judge 只做补充。** 它可评估因果链、可读性和自然语言可用性，但不得覆盖确定性失败，也不得成为唯一发布门。
5. **W1 不是独立压缩器。** W1 只有 Raw CAS、Reducers、Evidence、Exact/FTS 与主动 Recall；公平基线是 `Pi Native` 对 `Pi Native + W1`。真正的压缩器正面对比要到 W2 的 deterministic host checkpoint/materializer 完成后进行。

## 推荐阅读顺序

1. [`00-executive-summary.md`](00-executive-summary.md)
2. [`01-gap-audit-of-current-pcr-benchmark.md`](01-gap-audit-of-current-pcr-benchmark.md)
3. [`02-what-can-be-computed-directly.md`](02-what-can-be-computed-directly.md)
4. [`04-experimental-arms-and-factorial-design.md`](04-experimental-arms-and-factorial-design.md)
5. [`06-oracle-and-ground-truth.md`](06-oracle-and-ground-truth.md)
6. [`09-reader-isolated-evaluation.md`](09-reader-isolated-evaluation.md)
7. [`10-paired-closed-loop-continuation.md`](10-paired-closed-loop-continuation.md)
8. [`16-w1-early-net-value-gate.md`](16-w1-early-net-value-gate.md)
9. [`17-w2-compactor-head-to-head-gate.md`](17-w2-compactor-head-to-head-gate.md)
10. [`28-reference-algorithms-and-formulas.md`](28-reference-algorithms-and-formulas.md)
11. [`29-benchmark-runbook.md`](29-benchmark-runbook.md)
12. [`30-pi-native-vs-pcr-comparison-protocol.md`](30-pi-native-vs-pcr-comparison-protocol.md)
13. [`plans/00-master-implementation-plan.md`](plans/00-master-implementation-plan.md)

## 交付结构

```text
main specs/           方法与判门
adrs/                 冻结决策
schemas/              机器可读合同
examples/             可直接跑通的示例
configs/              smoke / gate / publication 配置
plans/                AI Agent 实施计划
tasks/                18 个独立 TDD Task
diagrams/             Mermaid 图源
checklists/            语料、运行、评分、发布检查表
scripts/               离线完整性与 Schema 验证
```

## 事实边界

该包是评测与实施规格，不包含已经完成的 Benchmark Runner，也不声称 W1 或 W2 已经通过 Gate。只有真实实现生成的、带哈希的运行结果和置信区间才能支持通过结论。
