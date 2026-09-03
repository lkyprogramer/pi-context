# 最终判定与 Claim Policy

## 允许声明

- Runtime 核心架构已按上一轮设计完成大部分实质接线；
- Probe-only、CAS Recovery、Tool Pair 和 Arm Isolation 的实现明显更可信；
- 当前 Live Gate 正确地保持 `keep-pi-native`；
- Publication 流程在证据不足时总体保持关闭。

## 禁止声明

- 当前源码可编译/可安装；
- 支持既定 Node/OS/Pi 矩阵；
- PCR 全产品路径优于 Pi Native；
- 100×3 完整通过；
- Provider Overflow Recovery 已验证；
- 三轮 Autonomous Recursive 已验证；
- main 已受 Required/Compatibility 保护；
- 可以发布 npm RC 或打开 Semantic Beta。

## 下一次可升级条件

只有同时满足以下条件才允许把默认从 Native 改为 PCR：

1. same HEAD 的 Required 和 Compatibility 全绿；
2. branch protection 实际启用；
3. B2 vs B0 Product Adoption Gate 通过；
4. planned sample completion ≥ 99%，无家族集中超时；
5. exact recovery、must-omit、tool pair、side-effect 均为硬门；
6. Natural Pressure、Forced Overflow Recovery、Autonomous Recursive 通过；
7. RC bundle bytes/canonical 双哈希、secret scan、SBOM、clean install 均通过；
8. `publicationClaim` 由机器 Gate 生成，不由文档手写。
