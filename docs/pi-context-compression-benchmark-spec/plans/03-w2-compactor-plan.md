# W2 Compactor Head-to-head 实施计划

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 目标

在完全相同 W1ShapedTrace、Cut 与 Budget 上隔离 Pi Native 和 PCR Deterministic Compactor。

## 步骤

1. B07 生成 B0/B1/B2；
2. B08 验证 Artifact 硬不变量；
3. B11 用两个 Reader 跑 Probe + Full-context ceiling；
4. B12 对 100 Boundaries 做 paired continuation；
5. B13 计算 Summary/Hook/Cache/Cost；
6. B15 判 2% 非劣；
7. B17 输出 Gate Decision。

## Cut/Budget 一致性

- 同 source span；
- 同 retained-tail target；
- 同 I_eff；
- target visible tokens 允许 ±5%；
- 超出 band 的 artifact-only efficiency 不参与聚合，但闭环失败仍计入 Arm 失败。
