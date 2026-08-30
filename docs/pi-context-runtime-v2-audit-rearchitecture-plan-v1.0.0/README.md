# Pi Context Runtime v2：源码审计、彻底重构与验证计划

本包针对 `https://github.com/lkyprogramer/pi-context@9b5e207db04a197481d732ff206c0b1210aaa2e2` 的当前实现与 `2026-08-28-w2-live-native-pairing` 结果进行源码级复核。结论不是“Pi Native 一定更好”，也不是“只修 temporal regex 即可”，而是：

> 当前 Live W2 测到的是一个带大量硬编码和空实现的演示 Composition Root；同时测试 Oracle、闭环评分、样本独立性和恢复门也存在实质错误。现有 100 对结果只能证明“这个演示 checkpoint 不足以替代 Pi Native”，不能判定完整 PCR 架构无价值。

## 最终技术决策

1. **停止在现有 Composition Root 上增量补丁。** 保留可复用纯函数，但重写 Runtime、Pi Adapter、Storage Wiring 和 Acceptance Harness。
2. **先完成可运行的 deterministic vertical slice，再讨论 semantic layer。**
3. **测试体系从 template×ID 的合成 Gate 改为 source-witness Oracle + cluster paired continuation。**
4. **每个 Task 都是独立 Reviewer Gate，具备 RED/GREEN、文件边界、接口、故障矩阵、证据和原子提交协议。**

## 阅读顺序

1. `00-executive-summary.md`
2. `05-runtime-integration-audit.md`
3. `09-w2-live-report-reanalysis.md`
4. `10-root-cause-model.md`
5. `12-target-architecture.md`
6. `22-evaluation-v2.md`
7. `plans/00-master-implementation-plan.md`
8. `tasks/EXECUTION-PROTOCOL.md`

## 基线

- 仓库 commit：`9b5e207db04a197481d732ff206c0b1210aaa2e2`
- tree：`c3041e01eee6517dbd0a1c085d4990ba9b1c9417`
- Pi Coding Agent：`0.84.3`
- 当前远端 CI：compatibility workflow 在 frozen-lockfile 安装阶段失败，测试未执行。
