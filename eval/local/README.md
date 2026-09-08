# eval/local — live episode harness (E01)

Host-side runner for official Pi 0.85.1 against the production NInfer model at `http://47.106.205.246:1082/v1`. Do not change anything on the 4090. API keys stay in the gitignored repo `.env` (`PCR_LIVE_API_KEY`); they are never committed.

## Endpoint and identity

```bash
bash eval/local/ensure-tunnel.sh
bash eval/local/metrics-snap.sh /tmp/m.json
```

`ensure-tunnel.sh` is idempotent. For a non-loopback `PCTX_MODEL_BASE_URL` / `PCR_LIVE_BASE_URL` it only GETs `/v1/models` (with Bearer token if set) and fails unless `data[0].id` is `openclaw/Qwen3.8-27B-WORK` and `n_ctx` is `262144`. Loopback URLs still open the SSH tunnel to `hhtele@192.168.10.29`. No tokens or passwords are stored in this tree.

The public nginx front does not expose `/metrics`; snapshots then write `available: false` rather than zeros.

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

Sandbox (`eval/local/sandbox/run-agent.sh`) is the default. `--no-sandbox` is only allowed for H03. Outputs: `result.json`, `events.jsonl`, `status.json` (plugin arms), `metrics-before.json`, `metrics-after.json`, `session/session.jsonl`. `events.jsonl` stores tool-result length and sha256 only.

## Seed recording

```bash
node eval/local/record-seed.mjs --allow-host --out eval/local/seeds/java-three-nonce.jsonl
```

Nonce plaintext is `*.secret` (do not git add). The JSONL must contain the nonce inside a bash toolResult.

## Output directory

Use a throwaway path or `artifacts/local-eval/<runId>/`. Do not commit episode artifacts or `.secret` files.
