# HANDOFF

## 当前状态（6.1）

`v5/native-first` 上 A01–E04 的代码与本地评测已按 [docs/pi-context-native-first-audit-v6.0.0](docs/pi-context-native-first-audit-v6.0.0/AI-START-HERE.md) 收口。

- 宿主：官方 Pi **0.85.1**（工作区 `node_modules/@earendil-works/pi-coding-agent`；本机 PATH 上可能没有 `pi`）。
- 默认 profile：**observe**（history 工具 + 不改写发往 provider 的消息）。不要改默认 profile。
- 本环境决策：`decision: limited-balanced-trial`（`artifacts/local-eval/20260909-112407/report.md`）。balanced 阈值折叠 **default-off, trial in this environment**。对照 run：`20260909-103813`（质量门 L06 class 误伤）、`20260908-215433`（机制门 / 无 metrics）。
- 模型：`openclaw/Qwen3.8-27B-WORK` via `http://47.106.205.246:1082/v1`。`/metrics` 需带 API key（无 key 是 401）。
- 不要 push、publish、打 tag，除非用户另行授权。不要提交 `.env`、`eval/local/seeds/*.secret`、`artifacts/local-eval/`。

## 已知限制

- Node 本机 `v22.17.0` vs `engines >=22.19.0`（警告）；沙箱镜像是 22.19.0。
- 此栈 `cacheRead` 常大于 `input`，Σuncached 记 n/a；成本以 engine `prefillTokensDelta` 为准。
- H02 balanced 两次都没有逐字引用种子断言（`lost evidence 2/2`），触发 `post-compaction-evidence-delta`。
- H03 未到 60% trigger（本轮未折叠）。
- H03 在 host 上跑：评测前会把 `HOME` 指到临时目录，评测后必须恢复，否则 `grade.sh` 的 Docker 会找不到 `~/.docker`。

## 常用命令

```bash
pnpm smoke
pnpm typecheck
pnpm eval:report artifacts/local-eval/20260909-112407
pnpm build && node scripts/packed-host.mjs
```
