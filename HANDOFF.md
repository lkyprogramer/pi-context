# HANDOFF

## 当前状态（6.1）

官方 Pi **0.85.1** 上的 native-first 插件已按 [docs/pi-context-native-first-audit-v6.0.0](docs/pi-context-native-first-audit-v6.0.0/AI-START-HERE.md) 收口。可执行 harness 只有 `eval/local/`。

- 默认 profile：**observe**（`pctx_history` + 不改写发往 provider 的消息）。不要改默认 profile。
- 6.1-next-steps 交付决策：`inconclusive`（`artifacts/local-eval/review-final/REPORT.md`）。冻结 32+4 review 矩阵 live 为 **UNRUN**。
- 被取代的个人试用：`20260909-112407`（`limited-balanced-trial`）。对照：`20260909-103813`、`20260908-215433`。不要删除这些失败/试用记录。
- balanced 仍是 default-off。没有完整 live 证据时不得把默认改成 balanced。
- 模型：`openclaw/Qwen3.8-27B-WORK` via `http://47.106.205.246:1082/v1`。`/metrics` 需 API key（无 key 是 401）。
- 打包：`pi-context-6.1.0.tgz` sha256 `36c1019d7e46864c5fc3cb5bff426ea178b4da6eba3f7563b5cf1d5ca372b1cd`。
- 不要提交 `.env`、`eval/local/seeds/*.secret`、或带会话正文的 live 产物。可提交脱敏的 `artifacts/local-eval/review-final/`。不要 publish、不要打 tag，除非用户另行授权。

## 已知限制

- 本机 Node `v22.17.0` vs `engines >=22.19.0`（警告）；沙箱镜像是 22.19.0。
- 此栈 `cacheRead` 常大于 `input`，Σuncached 记 n/a；成本以 engine `prefillTokensDelta` 为准。
- H02 balanced `lost evidence 2/2` → `post-compaction-evidence-delta`。
- H03 未到 60% trigger（folds=0）。
- H03 必须走父 broker + sandbox（R06 已删除 `--no-sandbox` / host 直跑）。

## 常用命令

```bash
pnpm check
pnpm build && pnpm smoke
node eval/local/secure-preflight.mjs --canary
pnpm eval:report artifacts/local-eval/review-final
node scripts/packed-host.mjs
```
