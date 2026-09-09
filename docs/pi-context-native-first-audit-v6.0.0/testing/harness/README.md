# harness 模板

可执行脚本的唯一来源是仓库 `eval/local/`。本目录只保留题目、`cases.json`、`pi-config` 与隧道/判题脚本，不再附带 `report.mjs` / `run-episode.mjs` / `parse-session.mjs` / `run-matrix.mjs`。

路径假设：仓库根 `/Users/luo/Documents/github/pi-context`，官方 pi 在工作区 `node_modules/@earendil-works/pi-coding-agent` 或 `$(npm root -g)/@earendil-works/pi-coding-agent`。实际 endpoint 以每 episode `manifest.baseUrl` 为准；脚本不含任何口令。

```bash
bash eval/local/ensure-tunnel.sh
bash eval/local/metrics-snap.sh /tmp/m.json
node eval/local/run-episode.mjs --case L04 --arm native --window w262k --rep 0 --out /tmp/ep
node eval/local/record-seed.mjs --out eval/local/seeds/java-three-nonce.jsonl --allow-host
node eval/local/run-matrix.mjs --out artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
node eval/local/report.mjs artifacts/local-eval/<runId>
```

`run-episode.mjs` 在 E01 阶段直接在主机运行 Agent（`--no-sandbox`），E02 之后默认走 `sandbox/run-agent.sh`。所有脚本对 `import` 的官方 SDK 符号（`createAgentSession`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、`SettingsManager`）以 `dist/index.d.ts` 为准；本仓库 `test/helpers/official-pi.ts` 已在用同一套。
