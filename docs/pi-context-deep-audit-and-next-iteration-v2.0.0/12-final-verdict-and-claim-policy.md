# 最终判定与声明政策

## 产品决策

```yaml
default_compactor: pi-native
pcr_ingress: enabled/retain
pcr_storage_retrieval: enabled/retain
pcr_checkpoint: shadow-or-explicit-experimental
semantic_background: disabled
publicationClaim: false
releaseReady: false
```

## 为什么不是 adopt PCR

PCR 在某些运行中表现出非常强的 Artifact 缩短、输入节省和延迟优势，也在 must-omit 泄露上优于 Native；但当前没有一个同一最终 HEAD 的完整 Run 同时满足：

- Directive exact coverage；
- CAS exact recovery；
- Actual tool pair；
- Probe-only reader；
- Environment closed-loop；
- Quality non-inferiority；
- Prompt-cache adjusted realized net；
- 真实 B2/F0；
- Natural/Overflow/Recursive success；
- Required+Compatibility 全绿。

## 声明矩阵

| 声明 | 当前是否允许 | 条件/限定 |
|---|---|---|
| PCR checkpoint 更短/更快 | 有条件 | 仅指明具体 pre-fix Run、模型、样本和 Hard failure |
| PCR 不把当前 must-omit marker 写进 summary | 有条件 | 仅当前语料 visible summary；不是绝对 secret guarantee |
| PCR 保留全部关键指令 | 否 | 完整 post-fix 100×3 未跑 |
| PCR exact recovery 100% | 否 | 当前 live metric 不是 CAS read |
| PCR 整体优于 Native | 否 | 无完整 Hard+Quality+Efficiency 证据 |
| Natural 200K 已验证 | 否 | 未触发 |
| Provider Overflow 已验证 | 否 | 未观察到 overflow |
| Recursive Long-horizon 已验证 | 否 | 只 compact 一次 |
| Deterministic MVP 已验收 | 否 | Compatibility/Runtime/Live 阻断 |
| 可作为内部 Alpha 继续迭代 | 是 | 默认 Native、PCR shadow、不开 Semantic Beta |

## Kill/Advance Criteria

- W1 Runtime ownership 无法在不改 Pi Host 的情况下闭环：明确 fork/patch contract，不用 adapter heuristic 掩盖；
- Post-fix 100×3 质量显著回归：保持 Ingress/Recovery，停止替换 Native Compactor；
- 实际 cache-adjusted cost 不降：缩短 checkpoint metadata 或只在 overflow 使用；
- Recall 未提升 task success：默认关闭主动注入，只保留 manual exact read；
- Compatibility 无法稳定：停止发布，先修测试/宿主版本矩阵。
