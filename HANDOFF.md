# HANDOFF

## 当前状态（6.1）

官方 Pi **0.85.1** 上的 native-first 插件已按 [docs/pi-context-native-first-audit-v6.0.0](docs/pi-context-native-first-audit-v6.0.0/AI-START-HERE.md) 收口。可执行 harness 只有 `eval/local/`。

- 默认 profile：**observe**（`pctx_history` + 不改写发往 provider 的消息）。不要改默认 profile。
- 本环境决策：`limited-balanced-trial`（`artifacts/local-eval/20260909-112407/report.md`）。balanced **default-off, trial in this environment**。
- 对照：`20260909-103813`（L06 `*.class` 误伤质量门）、`20260908-215433`（机制门 / 无 metrics）。
- 模型：`openclaw/Qwen3.8-27B-WORK` via `http://47.106.205.246:1082/v1`。`/metrics` 需 API key（无 key 是 401）。
- 打包：`pi-context-6.1.0.tgz` sha256 `36c1019d7e46864c5fc3cb5bff426ea178b4da6eba3f7563b5cf1d5ca372b1cd`。
- 不要提交 `.env`、`eval/local/seeds/*.secret`、`artifacts/local-eval/`。不要 publish、不要打 tag，除非用户另行授权。

## 已知限制

- 本机 Node `v22.17.0` vs `engines >=22.19.0`（警告）；沙箱镜像是 22.19.0。
- 此栈 `cacheRead` 常大于 `input`，Σuncached 记 n/a；成本以 engine `prefillTokensDelta` 为准。
- H02 balanced `lost evidence 2/2` → `post-compaction-evidence-delta`。
- H03 未到 60% trigger（folds=0）。
- H03 在 host 上跑时会改 `HOME`；评测后必须恢复，否则 `grade.sh` 找不到 `~/.docker`。

## 常用命令

```bash
pnpm smoke
pnpm typecheck
pnpm exec vitest run --config vitest.config.ts
pnpm eval:report artifacts/local-eval/20260909-112407
pnpm build && node scripts/packed-host.mjs
```
