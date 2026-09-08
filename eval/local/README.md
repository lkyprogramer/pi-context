# eval/local — 4090 episode harness (E01)

Host-side runner for official Pi 0.85.1 against the production NInfer model at `http://127.0.0.1:18343/v1` (SSH tunnel). Do not change anything on the 4090.

## Tunnel and identity

```bash
bash eval/local/ensure-tunnel.sh
bash eval/local/metrics-snap.sh /tmp/m.json
```

`ensure-tunnel.sh` is idempotent. It forwards `127.0.0.1:18343` to `hhtele@192.168.10.29` and fails unless `data[0].id` is `openclaw/Qwen3.8-27B-WORK` and `meta.n_ctx` is `262144`. No tokens or passwords are stored in this tree.

## Window profiles

Only Pi `models.json` `contextWindow` changes. The server stays at 262k.

- `w262k` — production window 262144
- `w64k` — diagnostic window 65536 (native compact ~49152, fold trigger 60% ≈ 39321)

## Arms

Each episode gets a fresh `HOME` / `agentDir` / `cwd`.

- `native` — no `settings.json.extensions`
- `observe` / `balanced` — `extensions` points at `dist/extension.js` and `.pi/pctx.json` sets `profile`

## One episode

```bash
pnpm build
node eval/local/run-episode.mjs --case L04 --arm native --window w262k --rep 0 --out /tmp/pctx-e01-smoke
```

Until `eval/local/sandbox/run-agent.sh` exists (E02), the runner executes the agent on the host. Outputs: `result.json`, `events.jsonl`, `status.json` (plugin arms), `metrics-before.json`, `metrics-after.json`, `session/session.jsonl`. `events.jsonl` stores tool-result length and sha256 only.

## Seed recording

```bash
node eval/local/record-seed.mjs --allow-host --out eval/local/seeds/java-three-nonce.jsonl
```

Nonce plaintext is `*.secret` (do not git add). The JSONL must contain the nonce inside a bash toolResult.

## Output directory

Use a throwaway path or `artifacts/local-eval/<runId>/`. Do not commit episode artifacts or `.secret` files.
