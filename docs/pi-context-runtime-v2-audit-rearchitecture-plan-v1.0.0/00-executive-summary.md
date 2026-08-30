# 执行摘要

## 结论

当前项目并非“算法已经完整实现但真实效果不佳”。更准确的判断是：

- **模块层**：仓库拥有较多小型、类型化、可单测的 reducer、store、claim、continuity、materialization 和 worker 组件；
- **产品层**：`apps/pi-context-runtime/src/extension.ts` 没有把这些组件组成真实 Runtime。身份、预算、heads、continuity 均为常量；storage/lifecycle/view receipt 是空实现；claims/pointers 恒为空；Tool Result Capture 没有注册；Search/Recall 没有后端；
- **评测层**：W2 Live 报告主动披露了闭环评分污染和非 publication 属性，但还存在更严重的 Oracle 不可满足、伪重复、非真实压力、恢复与 tool-pair 硬编码等问题。

因此根因权重为：

| 类别 | 估计贡献 | 判断 |
|---|---:|---|
| 产品集成缺失 | 50% | 主因。测试到的不是完整设计。 |
| 评测设计错误 | 30% | Temporal Oracle 不可满足，闭环结果与 recovery 门失真。 |
| 算法本身边界 | 15% | 纯确定性 clause/selection 无法覆盖长期语义，但尚未被公平测量。 |
| 模型随机性/运行环境 | 5% | 有影响，但不是核心解释。 |

这些比例是审计推断，不是统计回归结果。

## W2 Live 中仍然可信的结果

- 两臂确实使用 live Pi `session.compact()`，100 对完成并共享 cut/tokensBefore；
- PCR checkpoint 比 Native 摘要短且前台 compaction 更快，因为 PCR 没有摘要 LLM 调用；
- Pi Native 会把未 scrub 的 secret 抄入摘要，说明 ingress secret policy 必须独立存在；
- 当前 PCR checkpoint 在 temporal update 上没有保存完整 correction clause。

## 不可信或不能外推的结果

- “PCR 闭环 80 vs Native 71”：summary+probe 并集会掩盖错误回答；
- “exact recovery=1”：实际只检查 secret 未出现在可见文本；
- “100 个独立边界”：实际是 5 个模板的参数化副本；
- “真实长程/overflow”：tokensBefore 约 6.2k，manual compact，未到 200k 窗口压力；
- “temporal 两臂 0/20”：期望的 `version=7-<id>` 根本不在源轨迹中。

## 重构原则

- 只允许一个真实 Composition Root；所有 production ports 必须由真实 adapters 注入，禁止 fixture defaults；
- 以完整 authenticated user turn 作为兜底真相，Directive 只是索引；
- Compaction 失败要回退 Pi Native，而不是取消宿主压缩；
- Materializer 必须对真实 block 内容计价并完整控制最终消息顺序；
- Benchmark 必须先验证 Oracle 有 source witness，再运行 arm；
- benchmark corpus 一旦冻结，Gate 失败后不得修改同版本语料以制造收益。
