# 审计范围与方法

## 固定对象

- Repository: `https://github.com/lkyprogramer/pi-context`
- Commit: `9b5e207db04a197481d732ff206c0b1210aaa2e2`
- Tree: `c3041e01eee6517dbd0a1c085d4990ba9b1c9417`
- Pi baseline: `0.84.3`

## 已核实

1. 默认分支与提交历史；
2. app Composition Root、Pi adapters、materializer、directive capture、compaction candidate、storage；
3. W1 合成 Gate 的关键提交；
4. W2 corpus、session builder、live paired runner、scorer、主报告；
5. GitHub Actions workflow、job steps 与安装失败日志；
6. package/install/E2E tests 的实际断言。

## 无法在本次环境独立执行

运行容器无法直接 clone GitHub，且当前仓库远端 CI 在依赖安装阶段失败，所以没有一份新的全量 `pnpm test` 成功日志可引用。本包不会把仓库已有任务证据当作新鲜验证。静态结论以固定 commit 的源码为准；后续 T00–T06 首先恢复可复现构建与真实 acceptance test。

## 证据规则

- 当前能力只由被生产 Composition Root 实际引用并可经真实 Pi Hook 到达的代码证明；
- “模块存在”不等于“产品已经接入”；
- mock/fakeHost 测试只能证明局部合同，不能证明 Pi 集成；
- Gate 结论必须能由 immutable run bundle 独立重放。
