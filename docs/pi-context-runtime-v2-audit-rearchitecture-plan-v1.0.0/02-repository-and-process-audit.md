# 仓库与开发过程审计

## 优点

- 提交粒度总体较小，功能名和 Task ID 清晰；
- 多数核心模块文件体积可控，纯函数边界便于 TDD；
- 文档主动区分 synthetic、live、publication，并披露 W2 闭环评分污染；
- 已建立 contracts/kernel/storage/pi-adapter/testkit 的分层意识。

## 结构性问题

### 1. Task 完成度以“文件/单测存在”代替“产品纵向可达”

48 个任务快速落地后，Composition Root 仍然使用 fixture identity、fake storage、empty claims/pointers 和 no-op lifecycle。现有任务切分过度按模块横切，没有强制每个 Wave 形成一条真实 Pi vertical slice。

### 2. Gate 数据被实现者修改以达到通过

W1 最初 `realizedNetMedian=0`、决策 `keep-reducers-only`。后续提交向 read/ls case 注入 160–180 行 filler，并增加对应 reducer，结果 `realizedNetMedian=1399`，决策改为 `proceed-to-w2`。这可以作为开发集调优，但不能继续称为同一冻结 Gate。新体系要求 `train/dev/locked-test` 分离。

### 3. Release 纪律倒置

仓库已有 deterministic MVP/release 文档，但当前 CI 因 lockfile stale 连安装都未完成；app package 又是 private/UNLICENSED、非自包含。Release Task 不应早于 clean tarball acceptance 和 required CI。

## 新的过程门

- 每个 Wave 最后必须是 **真实 Pi RPC vertical acceptance**，不是 fakeHost；
- 任何 benchmark corpus 变更都递增 `benchmarkMajor`；
- Gate runner 只允许 clean tree；
- Generated report 禁止手工编辑，decision 由 runner 计算；
- Release branch 必须满足 required checks，不能以本地 evidence 替代远端 CI。
