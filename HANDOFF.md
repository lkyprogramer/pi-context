# HANDOFF

## 当前状态（6.1）

`v5/native-first` 上 A01–E04 的代码与本地评测已按 [docs/pi-context-native-first-audit-v6.0.0](docs/pi-context-native-first-audit-v6.0.0/AI-START-HERE.md) 收口。

- 宿主：官方 Pi **0.85.1**（工作区 `node_modules/@earendil-works/pi-coding-agent`；本机 PATH 上可能没有 `pi`）。
- 默认 profile：**observe**（history 工具 + 不改写发往 provider 的消息）。
- 本环境决策：`decision: observe-only`（`artifacts/local-eval/20260908-215433/report.md`）。balanced 阈值折叠 **default-off, not recommended**。不要改默认 profile。
- 模型：`openclaw/Qwen3.8-27B-WORK` via `http://47.106.205.246:1082/v1`（用户指定；原 runbook `192.168.10.29:18343` 本机不可达）。`/metrics` 为 404，engine prefix/prefill 为 unknown。
- 不要 push、publish、打 tag，除非用户另行授权。不要提交 `.env`、`eval/local/seeds/*.secret`、`artifacts/local-eval/`。

## 下一步（仅当这些证据出现）

不要为了让 balanced 过门而改 fold 参数或改题。下一轮只在同时出现时才重新打开 balanced 试验：

1. H01 balanced 至少 1 个 episode **同时** `oracle.passed`、`verifiedReads >= 1`（由 session JSONL 离线计数，不是插件自报）、且 nonce 所在 toolResult 已被折叠。现有 seed 下 nonce 往往未进 stub，该门会明确报 `nonce toolResult was not folded`。
2. 折叠后请求的 `cacheRead`（或可用的 engine `/metrics` prefill）能证明前缀作废后恢复，而不是全程 `cacheRead=0` / `metrics available:false`。
3. H03 在生产窗口下用量真正接近 trigger（本次只到约 20% context，未折叠）。

## 已知限制

- Node 本机 `v22.17.0` vs `engines >=22.19.0`（警告）；沙箱镜像是 22.19.0。
- `usage.cacheRead` 在此 OpenAI-compat 端点上恒为 0；不能据此谈成本。
- H02 三臂 `outsideEditable>0`（模型在 fixture 外写文件）；质量门只看 L01–L06 的 balanced vs native。
- H03 在 host 上跑：评测前会把 `HOME` 指到临时目录，评测后必须恢复，否则 `grade.sh` 的 Docker 会找不到 `~/.docker`。
- 旧 lean-v4 / W5 / PCR live 产物仍在 `artifacts/` 下，与 6.1 决策无关，不要当本轮证据。

## 常用命令

```bash
pnpm smoke
pnpm typecheck
pnpm eval:report artifacts/local-eval/20260908-215433
pnpm build && node scripts/packed-host.mjs
```
