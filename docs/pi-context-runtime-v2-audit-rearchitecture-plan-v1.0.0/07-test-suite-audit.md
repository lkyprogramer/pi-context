# 测试套件审计

## 当前覆盖的价值

- pure reducer、contract/schema、部分 store 和 scorer 有单元测试；
- fakeHost 可以快速验证 extension 是否注册 hook/tool/command；
- Live W2 runner 能真正启动 Pi RPC 并执行 manual compaction。

## 关键缺口

### Fake E2E

`pi-factory-entry.test.ts` 只检查 hook 名称；`packed-install.test.ts` 临时写了一个与真实实现无关的三行 factory 再 import。它们不能证明当前 tarball 可安装或 Runtime 可运行。

### 默认测试不含 Live Gate

`pnpm test` 不执行 `live:w2-paired`。当前远端 CI 又在 install 阶段失败，因此没有任何新鲜的远端成功证据。

### 测试金字塔失衡

横向模块测试多，纵向状态迁移测试少。v2 的最小测试金字塔：

1. pure unit；
2. adapter contract against real Pi types；
3. in-process RuntimeSession integration；
4. Pi SDK/RPC acceptance；
5. paired closed-loop benchmark；
6. scheduled multi-model live lane。
