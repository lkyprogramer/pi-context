# 7 任务主计划

**目标：** 让 `eval/local/` 能对 balanced 给出可复算的正/负结论，并在真正相关的两个 regime（warm 会话中折叠、长会话多次 native compaction）里测量它；顺带关闭一处安全边界回退和一处未登记的设计偏离。
**架构：** 不变——官方 Pi 保留原生摘要，插件只在 ActiveView 上折叠 derived-exposed 的旧纯文本工具结果，`pctx_history` 提供精确回读，父进程 broker 持 Key。
**栈：** TypeScript、Node ≥ 22.19（沙箱镜像）、Pi 0.85.1、SQLite、Docker、Vitest。
**规格：** [目标设计](../design/00-target.md)、[合同](../design/01-contracts.md)、[协议](../testing/00-protocol.md)。

| 任务 | 名称 | 依赖 | 消耗 |
|---|---|---|---|
| [S01](S01.md) | 登记见证偏离，持久化确认只对 derived-exposed 字段 | 无 | 定向测试 |
| [S02](S02.md) | 从配对 usage 计算主/次目标，接入 attempt 成功率 | S01 | 定向测试 |
| [S03](S03.md) | 配对不一致门、3 rep、结构化 reason | S02 | 定向测试 |
| [S04](S04.md) | Q05 精确引用、候选信号接线、provenance、dirty 拒绝 | S03 | 定向测试 + 离线复算三次旧 run |
| [S05](S05.md) | Darwin 沙箱经 named volume 回到 network none，Key 不落盘 | S01 | Docker |
| [S06](S06.md) | W lane（warm）与 X lane（long）场景、seed、oracle | S03, S04 | Docker + 受控 Provider |
| [S07](S07.md) | 干净 HEAD 84-episode live、bundle、文档同步 | S01–S06 | 4090 ≈ 80–100 分钟 |

## AI 执行边界

先写行为红测，再改实现，保留负例。单任务以定向测试 + `pnpm typecheck` 结束；`pnpm check`、smoke、Docker、live 只在 S05/S06/S07 集中执行。共享 `eval/local/gate.mjs` / `report.mjs` / `run-matrix.mjs` 的 S02–S04 串行。文件清单是职责边界：确需越界，在 `docs/iterations/next-fixes.md` 对应段说明并检查影响；不得借越界修改默认策略、折叠参数或 oracle。

每任务一个可审查 commit；只 add 实际改动文件。遇到 BLOCKED 写清缺失环境和已完成部分。任务卡中的测试代码是要在目标仓库实现的规范，不表示本包已修好产品。
