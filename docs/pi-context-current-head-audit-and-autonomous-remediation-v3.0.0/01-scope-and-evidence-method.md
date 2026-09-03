# 审计范围与证据方法

## 输入

1. 用户附件源码 ZIP：`cb6f10b1-918f-4380-94c1-8771a737655e.zip`。
2. GitHub `lkyprogramer/pi-context` 当前 `main`：`0e684e3623f260cc0c49c6cc1d4c75cf69969f9f`。
3. 上一轮审计/执行规范 v2.0.0：B00–B31、Evidence v2、测试 Lane、Live/Publication Gate。
4. GitHub Actions 当前 HEAD 的 Required/Compatibility 结果与失败日志。
5. 仓库内 `artifacts/runs/w2-v3-live` 的 paired、natural、overflow、recursive 产物。

## 证据分级

- **L1 源码直接证据**：接口、实现、Schema、默认开关、workflow、脚本。
- **L2 Hermetic 执行证据**：可离线复跑的 unit/contract/integration/acceptance。
- **L3 Pack/Compatibility 证据**：真实编译、tarball、clean home、Node/OS/Pi 矩阵。
- **L4 Live Provider 证据**：目标 provider、真实 Pi、当前 HEAD、原始 arm 产物。
- **L5 Publication 证据**：完整样本、预注册 Gate、不可变 bundle、双哈希、保护分支、双主门全绿。

任何较低级别证据都不能替代较高级别结论。例如，Hermetic Recursive 通过不能推出 Live Autonomous Recursive 通过；源代码中存在 B2 arm 不能推出 Product Adoption Gate 已正确运行。

## 当前边界

本包记录当前 CI 的真实失败，不把“多数测试绿”改写成“项目绿”。附件源码用于静态复核；GitHub Actions 用于当前可编译、可打包和矩阵状态。Live Provider 数字只按仓库当前报告接受，并对不完整样本、超时和实验语义进行降级。
