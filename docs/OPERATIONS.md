# Operations (6.1)

This plugin talks to official Pi 0.85.1 only. Default profile is observe. Balanced fold is default-off. The 6.1-next-steps delivery decision is **`inconclusive`** (`artifacts/local-eval/review-final/`, live review matrix **UNRUN**). Dated trial `20260909-112407` (`limited-balanced-trial`) is superseded as a delivery claim and kept on disk.

## Model endpoint

Eval harness reads repo `.env` (`PCR_LIVE_BASE_URL` / `PCTX_MODEL_BASE_URL`, `PCR_LIVE_API_KEY` / `PCTX_MODEL_API_KEY`) and never commits those values.

- The trial used `http://47.106.205.246:1082/v1` (`openclaw/Qwen3.8-27B-WORK`, `n_ctx=262144`).
- The original runbook tunnel is `ssh -L 18343:127.0.0.1:18343 hhtele@192.168.10.29` then `http://127.0.0.1:18343/v1`.
- `GET {base}/models` must show that model id and `meta.n_ctx=262144`. Loopback URLs go through `eval/local/ensure-tunnel.sh`; a public `http(s)` base URL skips SSH.

## `/metrics` vs Pi `cacheRead`

Two independent lines. Do not mix them.

| Source | What it is | How to use |
|---|---|---|
| Pi `usage.cacheRead` | Compatibility field (`prompt_tokens_details.cached_tokens`). This stack often has `cacheRead > input`. | Channel presence only. Σuncached is `n/a` when the sum exceeds Σinput. |
| `GET {origin}/metrics` | Engine counters. Public GET without the API key is **401**, not 404. | Episode before/after snapshot. Cost gate uses `llamacpp:prompt_tokens_total` delta (`prefillTokensDelta`). |

`eval/local/metrics-snap.sh` sends `Authorization` from `.env`. Useful series:

- `llamacpp:prompt_tokens_total` — real prefill (no cache)
- `ninfer:prefix_cache_hit_tokens_total` — engine prefix hits
- `ninfer:requests_total` — request count; a mid-run reset invalidates deltas
- `ninfer:continuation_stable_prefix_restores_total` — stable-prefix restores

If the snap cannot authenticate, it writes `{"available":false}` and engine prefix/prefill stay unknown. Missing metrics cannot yield `limited-balanced-trial`. Do not invent zeros.

## `/pctx status`

After `pi -e ./dist/extension.js` or a packed install:

```text
profile=observe resolvedProfile=observe configHash=<64 hex> configSource=<path|default>
warnings=none hostVersion=0.85.1 contextWindow=<n> contextPercent=<n>
```

`/pctx status --json` prints the same view as JSON and writes `<agentDir>/pctx-status.json`. `hostVersion` must be `0.85.1`. Load failures force observe, keep the error in `warnings`, and notify once.

## Telemetry jsonl

Default `telemetry.jsonl` is `false`. When enabled (`"telemetry": { "jsonl": true }`), files land in `~/.pi/agent/pctx/telemetry/<sessionId>.jsonl`. Rotate or delete that directory; `maxLogBytes` (default 5 MiB) caps a single file. `telemetry.includeContent` cannot be true.

Eval episodes also write `artifacts/local-eval/<runId>/episodes/<id>/requests.jsonl` (gitignored).

## Return to observe

1. Set `"profile": "observe"` in `~/.pi/agent/pctx.json` and/or trusted `<cwd>/.pi/pctx.json`.
2. Or `/pctx profile observe` for the current session only (does not persist).
3. Confirm `/pctx status` shows `resolvedProfile=observe` and `folds=0` on a short prompt.
4. Do not leave `"profile": "balanced"` in a shared config unless you intend the trial.

## Eval commands

```bash
pnpm build
pnpm eval:local -- --out artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
pnpm eval:report artifacts/local-eval/<runId>
```

`--resume <runDir>` fills missing episode dirs only. Do not retune fold parameters and keep only the second run. Current evidence run: `20260909-112407`. Contrasts: `20260909-103813` (L06 class-file wrong-action), `20260908-215433` (no verified read, no metrics).

H03 episodes temporarily point `HOME` at a temp dir. Restore `HOME` before `grade.sh` so Docker still sees `~/.docker`.

## Packaging

```bash
pnpm build && node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```
