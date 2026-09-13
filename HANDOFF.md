# HANDOFF

## 当前状态（6.1）

官方 Pi **0.85.1** 上的 native-first 插件已按 [docs/pi-context-native-first-audit-v6.0.0](docs/pi-context-native-first-audit-v6.0.0/AI-START-HERE.md) 收口。可执行 harness 只有 `eval/local/`。

- 默认 profile：**observe**（`pctx_history` + 不改写发往 provider 的消息）。不要改默认 profile。
- 当前交付决策：`limited-balanced-trial`（run `review-r8-20260911b`，HEAD `878e92f292a7`）。个人显式试用；默认仍 observe；无非劣性声明。
- 第 7 轮交付时为 `inconclusive`（run `review-final`，HEAD `5a23e6a05a77`；当时 live 矩阵 UNRUN）。备份：`artifacts/local-eval/review-final-r7-backup/`。
- 被取代的个人试用：`20260909-112407`。对照：`20260909-103813`、`20260908-215433`。不要删除这些失败/试用记录。
- balanced 仍是 default-off。不得把默认改成 balanced。
- 模型：`openclaw/Qwen3.8-27B-WORK` via `http://47.106.205.246:1082/v1`。`/metrics` 需 API key（无 key 是 401）。
- 打包：`pi-context-6.1.0.tgz` sha256 `36c1019d7e46864c5fc3cb5bff426ea178b4da6eba3f7563b5cf1d5ca372b1cd`。
- 不要提交 `.env`、`eval/local/seeds/*.secret`、或带会话正文的 live 产物。`artifacts/local-eval/review-final/` 只跟踪 `REPORT.md`、`report.json`、`MANIFEST.sha256`；attempts / bundle / requests 等留本机（已被 `artifacts/local-eval/` ignore）。不要 publish、不要打 tag，除非用户另行授权。

## 已知限制

- 本机 Node 可能低于 `engines >=22.19.0`（警告）；沙箱镜像是 22.19.0。跑测试用 nvm Node 22.22.2。
- 此栈 `cacheRead` 常大于 `input`，Σuncached 记 n/a；成本以 engine `prefillTokensDelta` 为准。
- Q05：file oracle 双边全过。逐字 quote 只对日志/错误行 case（X01 / H02）入门；Q05 改为 `quoteMode=semantic`（`ZX-731`），不再把语义等价判成 lost evidence。
- X lane（X01，3 pair）Darwin `wxq-coldfold-20260913`：native 2/3（r2 file-oracle fail）、balanced 3/3；`protectedIntact` 6/6、`quotedVerbatim` 6/6。balanced 每条 folds=2（`reason=threshold`，无 seed，不是 resume 冷点）、nativeCompactions 1/1/1。long regime：b=0 c=1 shared=0，fresh-input **+0.689**（r8 为 +0.195，未降到 ≤ 0），nativeCompactions 4/3。不推广 balanced。
- H03 必须走父 broker + sandbox（R06 已删除 `--no-sandbox` / host 直跑）。

## 诊断数据（不作交付）

- hung run `artifacts/local-eval/review-r8-20260911/`：Linux `spawnSync` 冻住 in-process unix broker，Q01/native 卡住后中止。不是交付。
- 本工作区没有 `artifacts/local-eval/review-qc-*` 三次 dirty 诊断 run，未离线复算。不把 dirty / UNRUN / diagnosticOnly 结果写成交付。

## 常用命令

```bash
pnpm check
pnpm build && pnpm smoke
node eval/local/secure-preflight.mjs --canary
pnpm eval:report artifacts/local-eval/review-final
node scripts/packed-host.mjs
```
