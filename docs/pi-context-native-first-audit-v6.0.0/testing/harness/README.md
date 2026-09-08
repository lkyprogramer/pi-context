# harness 模板

复制到仓库 `eval/local/` 后使用。路径假设：仓库根 `/Users/luo/Documents/github/pi-context`，官方 pi 全局安装在 `$(npm root -g)/@earendil-works/pi-coding-agent`，隧道 `127.0.0.1:18343`。脚本不含任何口令；`ensure-tunnel.sh` 依赖已配置的 SSH key/agent。

```bash
bash ensure-tunnel.sh
bash metrics-snap.sh /tmp/m.json
node run-episode.mjs --case L04 --arm native --window w262k --rep 0 --out /tmp/ep
node record-seed.mjs --out seeds/java-three-nonce.jsonl
node run-matrix.mjs --out artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
node report.mjs artifacts/local-eval/<runId>
```

`run-episode.mjs` 在 E01 阶段直接在主机运行 Agent（`--no-sandbox`），E02 之后默认走 `sandbox/run-agent.sh`。所有脚本对 `import` 的官方 SDK 符号（`createAgentSession`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、`SettingsManager`）以 `dist/index.d.ts` 为准；本仓库 `test/helpers/official-pi.ts` 已在用同一套。
