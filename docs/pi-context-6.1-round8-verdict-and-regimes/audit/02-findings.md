# 问题清单与归因

严重度：P0 安全/交付有效性；P1 决定能否得出结论；P2 可诊断性/准确性。归因：`dev` 插件或评测代码缺陷；`test` 评测设计/门；`process` 流程与文档；`ceiling` 当前架构下不可消除，只登记。机器可读版本见 `findings.json`。

| id | 严重度 | 归因 | 问题 | 证据 | 任务 |
|---|---|---|---|---|---|
| G01 | P1 | test | 主目标从未计算，pipeline 不可能输出 `limited-balanced-trial` / `history-only` | `eval/local/run-matrix.mjs:155` 硬编码 `known:false`；`accounting.mjs:169`；三次 run `report.json.decision.reason` 均无 objective 字段 | S02 |
| G02 | P1 | test | 门把"候选新增失败"实现为"候选任何失败"，且 2 rep 不能区分模型抖动与退化 | `gate.mjs:101-103`；fold1 run：Q05 r1 native 败/候选胜，r2 反之，配对差 0，仍 `review-needed`；native 基线 14–15/16 | S03 |
| G03 | P2 | test | 6.2 候选信号未接线：CLI 传空数组，`candidates()` 只认 H01/H02 | `report.mjs:126-137,301`；Q05 balanced r2（folds=1, historyReads=0, historySearches=0, failed）满足 `fold-time-model-hint` 单样本却显示 `none` | S04 |
| G04 | P2 | test | `firstAttemptSuccess/finalAttemptSuccess` 为 null | `report.mjs:284-290` 未传 `attempts`；三次 run `attempts.jsonl` 各 ≈50KB 存在 | S02 |
| G05 | P1 | test | Q05 未按协议实现精确引用 oracle；`quotedVerbatim` 对 Q lane 全部 null | `review-fixtures/Q05.json` `contains`；`cases.json` Q05 无 `evidence`；`parse-session.mjs:193` 只扫 isError 源 | S04 |
| G06 | P0 | dev | Darwin 沙箱 agent 拥有出网；upstream key 落宿主临时文件 | `eval/local/sandbox/run-agent.sh` `--network container:$BROKER_CID`；`run-episode.mjs:455-473` sidecar 无 `--network` 限制、`writeFileSync(join(secretDir,"upstream.key"))` | S05 |
| G07 | P1 | process | 三次 run 均 `dirty=true`；`pluginSha256` 只哈希入口文件；tarball 未重建 | `manifest.json.git.dirty=true`；`pluginSha256=34dfcba7da19` 四次相同而 `distFiles.plugin.js` 已变；`tarballSha256=68add929` 不变 | S04, S07 |
| G08 | P1 | process | 文档写 UNRUN/inconclusive，磁盘有三次 `review-needed` live run；`CURRENT_RUNID` 过期 | `README.md:7,79`、`HANDOFF.md:8`、`docs/OPERATIONS.md:3`、`artifacts/local-eval/CURRENT_RUNID` | S07 |
| G09 | P1 | dev | R03 见证不变式被反转且未登记；`confirmPersistedFields` 确认了尚无 derived exposure 的字段 | `44e8333b` diff；`src/plugin.ts:519-524` 无 `exposed` 过滤（planner 仍过滤，故当前无错误折叠，但不变式失真） | S01 |
| G10 | P1 | test | 没有 warm-cache 会话中折叠 lane；Q lane 资源收益由 resume 冷启动主导 | fold1 vs 20260911：唯一差异是折叠时机，fresh input −64% vs +5.9% | S06 |
| G11 | P1 | test | 没有长会话 lane；native compaction ≥2 且 oracle 依赖压缩前证据的场景从未运行 | H03 `optional`、w262k、单臂、未跑；Q lane native compaction 每 run 仅 3–4 次 | S06 |
| G12 | P2 | test | Q seed 正文是 `uniquePad` 噪声，折叠不损失任何模型可能重复需要的信息 | `eval/local/review-seed.mjs:36-41,213` | S06（W lane 用真实文件内容） |

## 上限项（不开任务，写入设计与报告口径）

| id | 归因 | 内容 | 证据 |
|---|---|---|---|
| C01 | ceiling | 回读 opt-in：模型不调用 `pctx_history` 就丢分 | 16 个 balanced Q episode 中 1 次（Q05 r2）；`fold-time-model-hint` 候选样本 1，未达门 |
| C02 | ceiling | prefix-cache 引擎上 warm 会话中折叠在 fresh input 上无收益；代价是一次前缀失效，能省的重填只有折叠后的尾巴 | 20260911 Q01 balanced 序列 `(45078,0)→(4630,0)→(3835,4939)`；fresh input +5.9% |
| C03 | ceiling | balanced 的可证收益来源限于三类：resume 冷启动预填、每请求 KV/cacheRead 体积、推迟 native compaction | 三次 run 的 cacheRead −56~−85%、compaction 4→0、wall −9~−30% |

## 不在本轮

- `post-compaction-evidence-delta`：第 7 轮已否决，除非 X lane 证明丢失发生在 native compact 之后（S06 提供判据，S07 提供数据）。
- 折叠参数调优、`cold-aligned-fold` 实现：需要 W/X lane 数据，登记为 6.2 候选（`design/00-target.md` §5）。
