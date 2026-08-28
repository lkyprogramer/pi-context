# Glossary

- **RawTrace**：任何 reducer/compaction 前的权威轨迹。
- **BoundarySnapshot**：Pi Session、Workspace、Model、配置和后续任务的冻结边界。
- **Oracle Item**：带来源、极性、时间和期望可见性的机器可验证事实/约束。
- **Artifact**：某实验臂生成的模型可见上下文或 Compaction 产物。
- **Reader**：只读取 Artifact 回答 Probe 的固定模型。
- **Executor**：在闭环环境中继续执行任务的 Agent 模型。
- **Judge**：辅助评审自然语言质量的盲评模型。
- **W1ShapedTrace**：统一经过 W1 Ingress/CAS/Reducer 后的消息轨迹。
- **Compactor-isolated**：输入、切点、预算相同，只替换压缩器。
- **End-to-end**：比较完整产品栈，允许多个模块共同产生差异。
- **Non-inferiority**：新方案质量差异的置信区间下界不低于预注册 margin。
