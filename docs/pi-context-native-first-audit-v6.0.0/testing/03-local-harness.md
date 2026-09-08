# 本地 4090 评测 harness（E01–E03 的落地模板）

[harness/](harness/README.md) 目录里是可以直接复制到仓库 `eval/local/` 的脚本与题目。它们是**模板**：E01 把它们落到仓库、跑通第一个 native episode，并按官方 SDK 实际导出名修正；E02 加容器；E03 加矩阵与报告。本包自己不运行它们。

## 与 CodexGame 已验证做法的关系

CodexGame 的 `run_pi_java.sh` 用 `pi --print --mode json --no-session -e ...` 跑 Java 三题，已在现网证明：24 次 HTTP、prefix 命中 85%、Java 3/3。本 harness 换成 SDK（`createAgentSession`）而不是 CLI，原因有三：需要 `SessionManager.open` 载入种子历史、需要在结束时读插件 status、需要 `subscribe` 拿到每条 assistant 的 `usage.cacheRead`。Pi 配置（`models.json` provider `work`）与 CodexGame 一致，只把 `contextWindow` 改成 262144，并另设 w64k 诊断档。

## 文件清单

| 文件 | 作用 | 落地任务 |
|---|---|---|
| [ensure-tunnel.sh](harness/ensure-tunnel.sh) | 幂等建立 18343 隧道并校验 `n_ctx` | E01 |
| [metrics-snap.sh](harness/metrics-snap.sh) | 抓 NInfer `/metrics` 四个计数器为 JSON | E01 |
| [pi-config/](harness/pi-config/settings.json) | `w262k`/`w64k` 的 `models.json` 与 `settings.json` | E01 |
| [cases.json](harness/cases.json) | 12 场景的本地执行参数（与 scenarios.json 一致） | E01 |
| [cases/H01](harness/cases/H01/TASK.md) / [H02](harness/cases/H02/TASK.md) / [H03](harness/cases/H03/TASK.md) | 能力与观察题的 prompt 段 | E01 |
| [run-episode.mjs](harness/run-episode.mjs) | 单 episode：准备工作区/agentDir、可选种子、串行 prompt、事件记账、status | E01（E02 加容器） |
| [record-seed.mjs](harness/record-seed.mjs) | 录制含 nonce 的真实种子历史 | E01 |
| [parse-session.mjs](harness/parse-session.mjs) | 从 Pi JSONL 复算 requests/tool/compaction/history 计数 | E01 |
| [grade.sh](harness/grade.sh) | `--network none` 判题容器 | E02 |
| [arm-contract.mjs](harness/arm-contract.mjs) | arm 身份断言 | E03 |
| [run-matrix.mjs](harness/run-matrix.mjs) | 冻结 manifest、串行矩阵、预算 | E03 |
| [report.mjs](harness/report.mjs) | 配对汇总、engine 差值、机械决策 | E03 |

## 关键实现约定

- **Pi 的 usage 字段**：`message_end.message.usage = {input, output, cacheRead, cacheWrite, totalTokens, cost}`；本地栈通过兼容层返回 `prompt_tokens_details.cached_tokens`，Pi 在 `openai-completions.ts:1520` 归一化到 `cacheRead`。E01 第一次真实 episode 要在 `requests[]` 里看到第二条起 `cacheRead>0`；看不到就先去 curl 一次 `/v1/chat/completions` 看 usage 原始字段，再决定是否需要在 `models.json.compat` 加设置。
- **窗口 profile**：只改 Pi 侧 `models.json.contextWindow`，服务端 262k 不变。w64k 让 Pi 在 49152 处压缩、插件在 39321 处折叠。
- **种子历史**：`SessionManager.open(copyOfSeed, sessionDir, cwd)` 后传给 `createAgentSession({ sessionManager })`。种子里 assistant 有真实 `usage`，派生暴露自然成立。种子 JSONL 里的 `cwd`/路径与新工作区不同不影响（历史只是文本）。
- **arm 隔离**：每 episode 全新临时 `HOME`/`agentDir`/`cwd`；native 的 `settings.json` 没有 `extensions`；observe/balanced 写 `extensions:[<abs dist/extension.js>]` 与 `.pi/pctx.json`。`defaultProjectTrust: "always"` 让项目级 `pctx.json` 生效（与 A01 的 trust 规则一致）。
- **status 读取**：插件在 `session_shutdown` 或收到 `/pctx status --json` 命令时写 `agentDir/pctx-status.json`（C03 实现的 `StatusView`）；运行器读取它做 `assertArm` 与机制计数。
- **不落正文**：`events.jsonl` 对工具结果只记 `bytes/sha256/isError`。会话 JSONL 副本保留在 episode 目录（本地），不进 git。
- **TTFT**：`run-episode.mjs` 在 `message_start`（assistant）记起点、首个 `message_update` 记首 token，写入 `requests[].ttftMs/totalMs`；插件侧 `RequestRecord.ttftMs` 是独立测量，报告只用 harness 值，插件值用于互校。
- **wrong-action**：`grade.sh` 在宿主侧比对候选与可信夹具，产出 `outsideEditable`（既非 editable 也非 protected 却被改动的文件数）；`report.mjs` 把 `protectedIntact=false || outsideEditable>0` 计为一次 wrong-action。
- **lost evidence（H02）**：`run-matrix.mjs` 用 `parse-session.mjs verbatimQuote()` 离线检查 episode 自己的 session JSONL：最早 `isError=true` 工具结果里匹配 `cases.json.evidence.linePattern` 的那一行，是否被 episode 开始后的某条 assistant 文本逐字（空白折叠后）包含。源行不存在 → null（unknown），不计入分母。
