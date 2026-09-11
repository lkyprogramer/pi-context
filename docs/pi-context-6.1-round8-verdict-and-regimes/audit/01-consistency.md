# 一致性对照

对照对象：第 7 轮包 `docs/pi-context-6.1-audit-next-steps/`（R01–R10、`testing/00-protocol.md`、`design/00-target.md`）与 6.1 原始计划 `docs/pi-context-native-first-audit-v6.0.0/`。基线 `0e7fb400`。

## 与第 7 轮包

| # | 要求（出处） | 现状（证据） | 判定 | 归因 | 处置 |
|---|---|---|---|---|---|
| 1 | R03：原文必须进入过一次成功请求才可折叠；design §10 "重启缺证据则完整再发一次" | `44e8333b` 新增 `confirmPersistedFields` 把 ActiveView 内全部 text 字段置为已确认；`balanced-wire.test.ts` 由 "first wire keeps originals" 改为 "must already fold"；`next-fixes.md` 未记录 | 偏离 | 开发 | S01 登记 + 收紧为仅 `exposedEntryIds` 命中字段 |
| 2 | R08/协议：主目标与阈值在 run 开始冻结并用于裁决 | `run-matrix.mjs:155` `objective.known=false, relativeChange=null` 永不回填 | 未实现 | 测试 | S02 |
| 3 | 协议："普通候选新增失败标 review-needed" | `gate.mjs:101` 任一 candidate 失败即触发，不看 native 同 rep 结果；reason 不含 pair 信息 | 实现过严且不可诊断 | 测试 | S03 |
| 4 | R07/R08：first-attempt 与 final 成功率分别输出 | `report.mjs:284` 未传 `attempts` → 两项 `null` | 未接线 | 测试 | S02 |
| 5 | 协议："Q05 对应旧 H02：`quotedVerbatim` 是必需 oracle" | `review-fixtures/Q05.json` oracle 为 `contains: "ZX-731"`；`cases.json` Q05 无 `evidence`；gate 只对 `H02` 检查 quote | 未实现 | 测试 | S04 |
| 6 | 协议 rule 6 / 6.1 候选信号逐 episode 判定 | `report.mjs:301` 传 `candidates: []`；`candidates()` 只认 H01/H02 | 未接线 | 测试 | S04 |
| 7 | R06 红线：Agent `--network none` | Darwin：`run-agent.sh` 用 `--network container:$BROKER_CID`，sidecar 为默认 bridge → agent 拥有完整出网；upstream key 写入宿主 `/tmp/pctx-k-*/upstream.key` | 违反（仅 Darwin） | 开发/安全 | S05 |
| 8 | R08：manifest 绑定全部 dist 摘要；不可变 run 包 | `distFiles` 有；但 `pluginSha256` 与报告头只哈希 `dist/extension.js`（四次 run 值相同尽管 `plugin.js` 变了）；`tarballSha256` 未随 dist 重建；三次 run 全 `dirty=true` | 部分实现 | 测试/流程 | S04、S07 |
| 9 | R10：文档决策与 `report.json` 不得不一致 | README/HANDOFF/OPERATIONS/`review-final` 写 "live UNRUN / inconclusive"；磁盘有三次完整 live run 结论 `review-needed`；`CURRENT_RUNID`=`20260909-112407` | 不一致 | 流程 | S07 |
| 10 | R09：Q 场景"历史必要且发生折叠" | 20260910 run 全部通过但 `historyReads=3`：witness 曾泄漏在 stub head，`0e7fb400` 已修；20260911 起 Q03 balanced 仍有 1 次 0 回读通过 | 基本满足 | — | S06 W lane 用真实文件内容替代噪声 pad |
| 11 | 协议：`report.md` 尾注 | "Quality cases at w262k do not trigger folds by design" 与 Q lane（w64k、全部折叠）矛盾 | 过期文案 | 测试 | S04 |
| 12 | 协议："不得把 Node 22.17 写成满足 engines" | 本机 22.17 跑 `pnpm check` 带 EBADENGINE 警告；沙箱镜像 22.19 | 已知、已声明 | 环境 | 保持声明 |

R01、R02、R04、R05、R07（计量语义）、R08（`evaluateTrial` 对象形状、bundle）、R09（8+2 冻结、witness 隐藏）、R10（交付 `inconclusive`）：代码、测试、迭代记录三者一致，未发现偏离。

## 与 6.1 原始计划（v6.0.0）

| 项 | v6.0.0 要求 | 现状 | 判定 |
|---|---|---|---|
| exposure 来源 | 从 native 日志推导（toolResult 之后存在成功 assistant usage） | `exposedEntryIds` 仍是 planner 的硬过滤；`44e8333b` 后 wire 见证不再是额外前提 | 与 v6.0.0 一致，与第 7 轮包冲突（见上表 #1） |
| 12 指标 | task success、wrong-action、Σinput、ΣcacheRead、Σuncached、prefill delta、TTFT、wall、compactions、history reads、verified reads、lost evidence | 报告表格齐全；`Σuncached`/`cacheRead/input` 在 cacheRead>input 时为 n/a（此栈常态）；TTFT 为 `hookToFirstDeltaMs`，`ttftMs` null | 一致，口径已在第 7 轮修正 |
| 三门 quality/mechanism/cost | → `observe-only / limited-balanced-trial / inconclusive` | 被第 7 轮 `evaluateTrial` 五值枚举取代；旧 `decideGates` 仍在 `report.mjs` 但 CLI 不调用 | 第 7 轮有意取代；旧函数应删或标注（S04） |
| 6.2 候选三条信号 | 逐 episode 机械判定 | 见上表 #6 | 未接线 |
| H01/H02/H03 | 37 episode 矩阵 | 被 Q/C 32+4 取代；H03 标 optional 未跑 | 第 7 轮有意取代；X lane（S06）承接 H03 的长会话目的 |

## 与本包新增要求的关系

本包不重开第 7 轮已关闭的 F01–F12；只处理上表标为"偏离/未实现/未接线/不一致"的 10 项，编号 G01–G12 见 `02-findings.md`。
