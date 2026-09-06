# Posthorse 借鉴改造与 300 gate 收口报告

日期：2026-09-06；工作区：pi-context。结论：改造已实现，300 组均已尝试，报告完整性校验通过；**质量门禁未通过，继续 `keep-pi-native`，`publicationClaim=false`**。本轮仅本地分批提交，不推送、发布或部署。

## 最终运行

| 项目 | 结果 |
|---|---|
| 冻结候选 | `/private/tmp/pi-context-gate-20260905-2215` |
| 基础提交 | `ba25c24b4fe4ad05744b336d087f39ea645a3347`，叠加当时未提交改动 |
| 模型 | openclaw / `openclaw/Qwen3.8-27B-WORK` |
| 样本 | 100 个 synthetic-public 场景 × 3 次重复；不是独立真实 holdout |
| 执行时间（上海） | 2026-09-05 22:13:47 → 2026-09-06 02:54:40，约 4 小时 41 分 |
| 执行与完整性验证 | nohup；runner + verifier；最终 exit=0，verifier `ok=true` |
| 尝试 / 四臂完整成功 | 300 / 289；同 cut 的完整样本 289 |
| 失败 | 11 组、12 个 arm 请求超时；没有删除失败样本或放宽 180 秒阈值 |
| 实际路径 | 完整样本 B0 为原生压缩，B1/B2 为插件压缩，F0 不压缩 |
| 质量结论 | `hardGatePass=false`，`decision=keep-pi-native` |

`exit=0` 表示执行器及报告一致性校验正常完成，不表示 300 组全部成功，更不表示可发布或优于 Pi Native。verifier 在归档前于原冻结候选内重新执行并通过。

报告及证据：

- [原始 report.json 的逐字节副本](../../artifacts/runs/posthorse-300-gate-20260905-2210/gate/report.json)
- [决策](../../artifacts/runs/posthorse-300-gate-20260905-2210/gate/gate-decision.json)、[原始 run manifest](../../artifacts/runs/posthorse-300-gate-20260905-2210/gate/run-manifest.json)
- [nohup 日志](../../artifacts/runs/posthorse-300-gate-20260905-2210/nohup.log)、[实际启动脚本](../../artifacts/runs/posthorse-300-gate-20260905-2210/run.sh)
- [脱敏会话归档](../../artifacts/runs/posthorse-300-gate-20260905-2210/gate/pairs-sanitized.tar.gz)、[逐文件原始与归档哈希清单](../../artifacts/runs/posthorse-300-gate-20260905-2210/gate/pairs-archive-manifest.json)
- [候选源文件哈希](../../artifacts/runs/posthorse-300-gate-20260905-2210/source-manifest.json)、[收口验证与提交映射](../../artifacts/runs/posthorse-300-gate-20260905-2210/closeout-manifest.json)

报告原始 SHA256：`2fb72ab5f8fa1f44da27fc57e8078d64f689ffa1283e1fced98b57b54094005d`。未改写其中的原执行路径、commit 或决策，避免破坏原 manifest。迁移后的相对路径以上述链接为准。

## 结果解释

| 指标 | 观察值 | 可得结论与限制 |
|---|---|---|
| B2 请求输入 token 相对差中位数 | -9.35% | 有节省，但未达到 tokenWin 的 -15% 门槛 |
| 输入 token 绝对差中位数 | 44 | runner 的 `realizedNetMedian`；不是完整压缩费用或端到端时间收益 |
| 每成功请求输入 token 中位数相对差 | +2.39% | 报告名为 `costPerSuccessRelativeDelta`；这是 token 代理量，不是货币账单 |
| overflow 闭环成功率 | B0 85%，B2 95% | 60 个完整 overflow 样本的局部收益，不能越过硬门禁 |
| 完整样本约束违规数 | B0 9，B2 5 | 仍有真实约束失败，未实现全覆盖 |
| B2 directiveCoverage 硬门禁 | 0 | 这是“所有完整样本均满足”的布尔值，不代表覆盖率为 0% |
| exactEvidenceRecovery | 0 | B1/B2 成功 arm 的 recoveryStatus 均为 `n/a`，未证明精确证据恢复能力 |
| 完整样本 must-omit 测试标记泄露 | B0 57，B2 0 | 仅针对 corpus 的测试标记；不等于真实凭据扫描无泄露 |
| 质量差 bootstrap CI | 中位差及区间均为 0 | scorer 使用配对差的中位数，不能解释为各 arm 质量评分全为 0 或所有样本表现相同 |

主要未通过原因：只有 289 个完整样本、存在约束不满足、精确恢复未得到验证。保留原始 fail-closed 决策，不为获得通过结论修改结果。

超时分布：B0 8 次、B1 1 次、B2 2 次、F0 1 次；其中 `tu-03#s2` 同时影响 B0/F0。11 个失败组为：`tu-00#s0`、`tu-06#s0`、`tu-08#s0`、`tu-11#s1`、`tu-14#s1`、`tu-19#s1`、`br-03#s1`、`th-14#s2`、`ct-19#s2`、`tu-03#s2`、`tu-06#s2`。

## 实现与修复范围

1. **有界读取和检索**：context_read/recall 使用当前容量预算和分页；保留 UTF-8 / UTF-16 偏移语义；PCR 自己的检索结果不再次变成 observation；取消信号传递到搜索。
2. **恢复与来源校验**：以已认证、已链接的输入回执恢复当前分支指令，完整验证后原子写入 directive/claim 投影；不从摘要、助手文本或缺少回执的旧会话补造用户身份。
3. **存储与模块整理**：FTS 最近查询缓存按 cursor/query/limit 和数据库版本失效；生产检索预算归入 core，保留现有 W1 兼容入口。
4. **gate 修复**：canonical hash 基于实际持久化 JSON；合成用户语料通过生产 input/message_start 捕获与链接后再运行真实 arm；立刻检查压缩路径；回放只执行一次，失败按当前 arm 记录阶段；存储哈希绑定实际存储目录。
5. **已有补测改动收口**：W5 自然/递归 lane 检查真实答案、完整 usage 和自动 checkpoint；两组脱敏开发语料属于 dev、同源 cluster，不作为独立 holdout。
6. **移除云端 live CI**：删除两个云 workflow、专用 env 工具和测试；T50 blocker 标为历史范围。凭据仍留在本地配置，不同步至 GitHub。

没有切换 Pi fork，没有引入完整“无摘要换窗”，没有调整 Provider/model、gate 评分门槛或超时阈值。legacy backup/GC/key rotation 的 V2 迁移未纳入。读取分页仍先完整解密和校验 blob，不宣称降低解密峰值内存。

## 验证与前序失败

本次收口重跑：5 个定向单元测试文件共 33 项通过，launcher Python 测试 3 项通过；没有重新启动 Provider benchmark。命令记录见 closeout manifest。源码与非产物文档的 diff 检查通过；全量暂存检查在历史日志/补丁中提示输出格式空白，原始证据按字节保留，没有通过格式化改写哈希。

改造阶段已有：产品/宿主验收 21 项通过；gate 修复阶段新增回放与证据保留验收 3 项通过、相关 TypeScript 检查通过；packed、contract、集成检查及日志详见[开发阶段记录](../../artifacts/runs/posthorse-optimization-20260905/REPORT.md)。这些结果不替代本次真实 gate。只读审查已完成；提交前发现的过期 CI 文档、一次性脚本入口及证据映射问题已收口。

旧 gate 曾因 canonicalJsonSha256 不一致退出；第一次新版 smoke 只有 8/10 完整组，且候选回退原生压缩，因此 300 未启动。这些历史失败仍保留。修复后真实单组四臂预检成功；最终 289 个四臂完整样本中 B1/B2 均确认插件路径；其余 11 组失败不作路径成功声明。没有消除全部 Provider 超时或通过质量门禁。

## 安全归档与提交边界

原始证据扫描发现本地 Provider 凭据：旧 gate 8 个 session/raw 文件，最终 gate 14 个 session/raw 文件及 18 个 SQLite 文件。原件未删除或覆盖，也不提交。最终报告顶层 JSON 未命中该凭据，保持原字节。

- 两套会话 tar 仅包含脱敏文本和非 runtime-store 文件；最终归档 14 个文本文件替换凭据，旧归档 8 个。
- 最终 3,273 个 runtime-store 文件只保留原始路径/哈希清单，不随提交分发；此前名为 sanitized 的存储副本仍可能在 SQLite 内含敏感文本，因此不能因排除了 master.key 就认定可分享。
- 提交前复扫两个 tar 的全部 12,635 个文件，以及当时的 210 个待提交文件：按当前配置的真实 Provider key 和本地 .env 凭据值精确匹配，均为 0 命中；不泛化为“无任何秘密”。
- 脱敏副本独立记录 archiveSha256，绝不冒充原始 sourceSha256；精确原件仍在原本地路径。
- `.gitignore` 排除旧 gate 原始 pairs 目录和未执行的本地 `.workflow` 草稿；其余既有试验产物按历史证据归档，不据旧报告升级当前结论。
- 一次性 supplement 脚本以 `.sh.txt` 原样归档，依赖旧隔离目录，不作为可复用的 scripts 入口。

原 gate 的 epoch 主要绑定 HEAD/runner/lock/部分输入，`dist/extension.js` 只是加载入口；因此不能仅凭原 run-manifest 声称验证了最终提交。补充的 source manifest 记录 628 个源文件，范围为 apps/packages/tests/scripts 和顶层 JSON/YAML/TS/MJS；它是明确范围的 source-set 哈希，不是整个 Git tree hash。收口开始时当前工作树在该范围内与冻结候选无差异；之后仅将一次性 supplement 脚本归档。最终代码提交及重定位证明记入 closeout manifest。验证对象始终是冻结候选，未改写成提交后的 HEAD。

## 分批提交

- `b349595` — chore(ci): remove provider-backed cloud live workflows
- `db31f92` — feat(runtime): bound retrieval and restore authenticated branch state
- `b5b26e9` — fix(live-gate): replay ingress and retain verifiable arm evidence
- 报告、历史证据、脱敏归档和收口 manifest 作为独立文档批次提交；该提交自身哈希由 manifest 中的 git log 命令查询。

## 后续建议（本轮未执行）

优先核查 temporal-update 超时和剩余约束违规，再设计真正可验收的精确恢复样本及观测分母。后续发布前应补齐全源码 epoch 绑定和日志凭据保护。任何新一轮真实 gate 单独授权和记录，不续用本轮失败样本伪装全通过。
