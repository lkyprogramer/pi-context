# AI 自主执行入口

先读 `audit/00-verdict.md`、`audit/02-findings.md`、`design/00-target.md`、`design/01-contracts.md`、`testing/00-protocol.md`，再读当前任务卡。第 7 轮包（`docs/pi-context-6.1-audit-next-steps/`）仍是有效背景，但凡与本包冲突之处以本包为准；冲突点已在 `audit/01-consistency.md` 逐条列出。

目标仓库基线：`0e7fb400309612b106a28dcc89fe7f15d37b1b00`。代码 `src/`，活动测试 `test/`，唯一可执行 harness `eval/local/`。开始前运行 `git status --porcelain`；若 HEAD 已变，先 diff 相关文件，不得覆盖用户未提交改动，不得删除 `artifacts/local-eval/` 下任何已有 run。

## 执行顺序

S01 → S02 → S03 → S04 → S05 → S06 → S07。

- S01（插件侧唯一改动）独立于其他任务，但必须先完成，因为 S07 的 live run 要在包含 S01 的干净 HEAD 上跑。
- S02、S03、S04 都改 `eval/local/gate.mjs` / `report.mjs`，**串行**，每个任务一个 commit。
- S05 改沙箱脚本，与 S02–S04 无文件交集，可在 S01 后任意时刻执行；**任何 live 必须等 S05 通过**（Darwin 上 agent 必须回到 `--network none`）。
- S06 依赖 S03/S04 的 plan 字段。
- S07 是唯一消耗真模型的任务，只在 S01–S06 全部 GREEN、`pnpm check` 通过、工作树干净后执行。

## 每任务唯一流程

1. 运行任务卡里的 RED 命令；只有"目标行为断言失败"才是有效红测，模块不存在或依赖缺失只是起点，实现最小 API 后必须再确认断言在错误行为上确实失败。
2. 最小修改让目标测试通过；保留任务卡列出的负例。
3. 运行任务卡"完成验证"里的命令与 `pnpm typecheck`。把命令、exit code、变更文件、未验证边界写到 `docs/iterations/next-fixes.md` 新增的 `## S0x` 段（追加，不改 R01–R10 段）。
4. 一个可审查 commit，提交信息描述最终行为。禁止 `git add .`；只 add 任务卡文件范围内实际改动的文件，越界改动在迭代记录说明理由。
5. 不 push、不 tag、不 publish。

## 允许自主决策

局部函数拆分、补充负例、删除本轮造成的 dead code、调整测试文件内部结构。

## 不允许

- 修改默认 profile `observe`；修改折叠默认 `triggerPercent 60 / targetPercent 40 / protectRecentBatches 4 / minRemovedTokens 4096 / minFoldableBytes 1024 / stubHeadChars 120`。
- 修改任何 Q/C/W/X 场景的 oracle 使失败变成功；删除失败样本；把 `NOT_RUN` 从分母移出。
- 看到 live 数据后更换主目标指标。主目标在 S02 冻结为 `fresh-input`（理由见 `design/00-target.md` §3），S07 不得改。
- 读取真实 Key 用于测试断言；把 Key 写入 `models.json`、env、日志、manifest、commit。
- 在 dirty tree 上产出交付结论；把 dirty run 写成交付。
- 调用用户未提供的 Provider；自动重试到绿；提高 `maxTokens`。

## 完成判据

"代码存在""测试名叫 live""脚本 exit 0""文档写 done"都不是完成。S02–S04 的完成是：对现有三次 run 目录离线运行 `node eval/local/report.mjs --run <dir>` 时，输出的 `objective.relativeChange`、`discordant`、`candidates` 与 `evidence/run-aggregates.json` 中同名字段一致（允许四舍五入差异）。S07 的完成是：干净 HEAD、`PCTX_LIVE=1`、84 个 episode 全在 ITT 分母中、`report.json.decision` 与 README/HANDOFF/OPERATIONS 一致，且 `test/unit/docs-decision-consistency.test.ts` 通过。若环境缺失，写 `BLOCKED` 并列出已完成部分。
