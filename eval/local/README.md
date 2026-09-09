# eval/local — live episode harness

SSOT for the 6.1 local matrix. Official Pi 0.85.1 against `openclaw/Qwen3.8-27B-WORK`. Do not change anything on the 4090. API keys stay in the gitignored repo `.env` (`PCR_LIVE_API_KEY` / `PCTX_MODEL_API_KEY`); they are never committed.

The audit pack under `docs/pi-context-native-first-audit-v6.0.0/testing/harness/` keeps cases and Pi window configs only. It does not ship `run-matrix` / `report` / `run-episode` / `parse-session`.

## Endpoint and identity

```bash
bash eval/local/ensure-tunnel.sh
bash eval/local/metrics-snap.sh /tmp/m.json
```

`ensure-tunnel.sh` is idempotent. For a non-loopback `PCTX_MODEL_BASE_URL` / `PCR_LIVE_BASE_URL` it only GETs `/v1/models` (with Bearer token if set) and fails unless `data[0].id` is `openclaw/Qwen3.8-27B-WORK` and `n_ctx` is `262144`. Loopback URLs still open the SSH tunnel to `hhtele@192.168.10.29`. No tokens or passwords are stored in this tree.

`/metrics` needs the same API key. Unauthenticated GET is 401. `metrics-snap.sh` then writes `available: false` rather than zeros. Cost uses the episode delta of `llamacpp:prompt_tokens_total` (`prefillTokensDelta`). Do not treat Pi `usage.cacheRead` as prefill; on this stack it is often larger than `input`.

Current evidence: `artifacts/local-eval/20260909-112407` → `limited-balanced-trial`.

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

Restore `HOME` after an H03 host episode before running `grade.sh`, or Docker will miss `~/.docker`.

## Seed recording

```bash
node eval/local/record-seed.mjs --allow-host --out eval/local/seeds/java-three-nonce.jsonl
```

The writer stages `*.next` and replaces the seed only after validation. Nonce plaintext is `*.secret` (do not git add). The JSONL must contain the nonce inside a bash toolResult, not on the first line (a stub head must not leak it).

H02 `quotedVerbatim` matches the seed assertion line `idempotency broken`, not the obsolete `expected … but got …` example.

## Grader

`grade.sh` runs verify/Oracle in a network-none container. Extra files outside the editable set count as wrong-action, except `*.class`, `.DS_Store`, and `out/` (javac leftovers are not a fold defect).

## Output directory

Use a throwaway path or `artifacts/local-eval/<runId>/`. Do not commit episode artifacts or `.secret` files.

```bash
pnpm eval:local -- --out artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
pnpm eval:report artifacts/local-eval/<runId>
```
