# Operations (6.1)

This plugin talks to official Pi 0.85.1 only. Default profile is observe. Balanced fold is default-off, **trial in this environment** (`decision: limited-balanced-trial`, run `20260909-112407`).

## Model endpoint

Eval harness reads repo `.env` (`PCR_LIVE_BASE_URL`, `PCR_LIVE_API_KEY`) and never commits those values.

- This run used `http://47.106.205.246:1082/v1` (`openclaw/Qwen3.8-27B-WORK`, `n_ctx=262144`).
- The original runbook tunnel is `ssh -L 18343:127.0.0.1:18343 hhtele@192.168.10.29` then `http://127.0.0.1:18343/v1`.
- `GET {base}/models` must show that model id and `meta.n_ctx=262144`. Loopback URLs go through `eval/local/ensure-tunnel.sh`; a public `http(s)` base URL skips SSH.
- `{origin}/metrics` is optional. If nginx returns 404, `metrics-snap.sh` writes `{"available":false}` and engine prefix/prefill stay unknown. Do not invent zeros.

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
4. Do not leave `"profile": "balanced"` in a shared config after this eval.

## Eval commands

```bash
pnpm build
pnpm eval:local -- --out artifacts/local-eval/$(date +%Y%m%d-%H%M%S)
pnpm eval:report artifacts/local-eval/<runId>
```

`--resume <runDir>` fills missing episode dirs only. Do not retune fold parameters and keep only the second run.

## Packaging

```bash
pnpm build && node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```
