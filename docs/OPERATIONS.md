# Operations (6.1)

This plugin talks to official Pi 0.85.1 only. Default profile is observe. Balanced fold is default-off. Current delivery decision: `limited-balanced-trial` (run `review-r8-20260911b`, HEAD `878e92f292a7`). Personal explicit trial; default stays observe; no non-inferiority claim.

Round-7 delivery at that time was `inconclusive` (live review matrix UNRUN; run `review-final`, HEAD `5a23e6a05a77`). Dated trial `20260909-112407` is superseded as a delivery claim and kept on disk.

regimes (fresh-input relativeChange · nativeCompactions native/candidate):

- Q (24 pairs): −0.645 · 5/0
- warm (12 pairs): −0.017 · 12/2
- long (3 pairs): +0.195 · 4/1

candidates: `fold-time-model-hint` below-gate; `inline-ref-marker` below-gate; `cold-aligned-fold` met (diagnostic registration only, not implemented).

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

## On-disk artifacts

All under `<agentDir>` (`PI_CODING_AGENT_DIR` if set, else `~/.pi/agent`). Setting `PI_CODING_AGENT_DIR` moves index, status and plan files to the new dir; files left in `~/.pi/agent` are simply orphaned and can be deleted.

- `pctx-status.json` — last `/pctx status` view.
- `pctx/index.sqlite` — rebuildable FTS index (persistent workspaces only).
- `pctx/plans/<workspaceId>/<sessionId>.json` — active fold plan locators (identity + `entryId:blockIndex` + `sourceHash`, no text) so a resumed `pi` process keeps the same fold. Safe to delete; costs one unfolded request on the next resume.

## Coexistence with SoL-Pi and context-mode

All three can load on official Pi 0.85.1. They do not share state. Install is not enable: each plugin is gated by its own config / `settings.json` `extensions` list.

Host and unit tests isolate `HOME` / `PI_CODING_AGENT_DIR` and load **only** the staged `pi-context` package (`noSkills`, no extra extensions). That is the equivalent of turning SoL-Pi and context-mode off. Live or interactive checks that need a neighbour must add that package to the isolated agent dir and turn it on explicitly; do not inherit `~/.pi/agent`.

### SoL-Pi

- Action Fusion / Reducer / OCC stay SoL-Pi's. pi-context does not rewrite them.
- ObservationPack needs a persistent Pi session directory. `pi --no-session` (typical sub-agent) raises a non-fatal extension error: `requires a persistent Pi session directory`. Do not use OP-dependent features in no-session sub-agents; give the child a real `--session-id` / session dir, or leave OP off.
- `pctx_history read` accepts `obs_<24hex>` from `<sessionDir>/sol-pi/<sessionId>/observation-pack/objects/`. The ledger `contentHash` is checked before any page is returned. Paging uses pi-context cursors (not OP's 16 KiB `obs_recall` page).
- Reducer receipts (`sol_pi_evidence_receipt_v1`) are left untouched. `source_artifact` under that session's `sol-pi/<sessionId>/` tree is indexed so search can find the original log; `read` of `entryId:1` returns that archive after hash check. Paths outside the session runtime root are ignored.
- To exercise SoL-Pi in a test: copy or install it into the isolated `settings.json` `extensions` and use a persistent session. To disable it: omit it from `extensions` or leave its feature flags off.
- Compaction-front evidence index (observe and balanced): on `session_before_compact`, pi-context appends a ≤1.5 KB `<pctx-evidence>` block of derived-exposed, not-yet-read tool results (`id=` / `tool=` / `head≤80` / `bytes=`), newest first, current-branch only. The native cut point is unchanged. SoL-Pi OCC still applies because it calls `ctx.compact()`; this hook fires on that path too. The last `update_plan` tool-result id is reserved so the model can read the plan back after OCC clears SoL-Pi plan state. No candidates → hook returns nothing and native/OCC `generateSummary` still runs. Sessions that never compact stay byte-identical. This does not call `ctx.compact()` and does not take over compaction timing.

### context-mode

- Adds a large fixed prefix (skills + `ctx_*` tool schemas; measured ~5–7k+ tokens). No shared contract with pi-context.
- Not recommended as a default co-install. If a scenario needs it, `--no-skills` cuts the skill prefix. Fold / observe-identity tests must keep it unloaded.

### Co-install matrix

| Environment | Recommend | Keep off | Why |
|---|---|---|---|
| Local 4090 (cache $0) | Action Fusion + Reducer(openclaw) + pi-context | OCC; context-mode by default | Fusion/Reducer shrink tool results without busting prefix. OCC on this stack became "compact whenever it can" and wipes SoL-Pi plan state. pi-context observe still adds evidence index + `obs_` / receipt recall. |
| Cloud, billed on cache | ObservationPack + OCC + pi-context **observe** | Action Fusion if the provider already caches well; context-mode by default | OP + OCC trade context for cache-read discount. pi-context observe does not fold (no extra KV miss) and keeps receipts / `obs_` readable. Do not promote balanced until the cold-fold live gates pass. |

### Verification debt

- Darwin sidecar hop: **verified** on `wxq-coldfold-20260913` (HEAD `4d3e25a9`, Node v22.19.0, `broker-hop.json.kind = darwin-sidecar-volume-network-none`). Agent stays `--network none`; key stays in sidecar stdin, not in the agent env. First X01 pass died on macOS bash 3.2 `set -u` + empty `"${SEED_ENV[@]}"` (no seed file); launcher now always passes `PCTX_SEED`. That X retry is a resume after the harness fix, not a second delivery run. Delivery claim remains `review-r8-20260911b`.
- Cold-aligned-fold live on that same run (Q+W first pass, X resume): Q fresh-input **−65.1%** (gate ≤ −50% hold). W fresh-input **+25.7%** (missed ≤ −10%) but cacheRead **+9.5%** vs r8 **+100%** (OR clause). X fresh-input **+68.9%** (missed ≤ 0; r8 was +19.5%). W/X pass counts held or improved (W 10/12, X 3/3). Q native compact 4/0; W 8/2 (not up); X candidate compact 3 vs r8 1 (up). Seeded Q/W folds were `reason=threshold` because `createAgentSession` defaulted to `session_start=startup`; harness now sends `resume` when a seed is opened. Do **not** promote balanced. Default stays observe.
- TUI coexistence: **host smoke verified** (`test/host/sol-pi-tui-coexist.test.ts`) on official Pi 0.85.1. Isolated `HOME` / `PI_CODING_AGENT_DIR`, `noSkills`, context-mode unloaded. SoL-Pi is copied in explicitly (`actionFusion` + `observationPack` + reducer, OCC off) from `PCTX_SOL_PI_ROOT` or `~/.pi/agent/git/github.com/NVlabs/SoL-Pi`; without that tree the SoL-Pi arm is skipped. Together: `/pctx status` works, `pctx_history` and `obs_recall` both register, no `ctx_*` tools. SoL-Pi off: `/pctx` still works and `obs_recall` is absent. This is a `createAgentSession` TUI-bind smoke, not a human TTY session.

## Telemetry jsonl

Default `telemetry.jsonl` is `false`. When enabled (`"telemetry": { "jsonl": true }`), files land in `<agentDir>/pctx/telemetry/<sessionId>.jsonl`. Rotate or delete that directory; `maxLogBytes` (default 5 MiB) caps a single file. `telemetry.includeContent` cannot be true.

Eval episodes also write `artifacts/local-eval/<runId>/episodes/<id>/requests.jsonl` (gitignored).

Report recall columns (`refDenials`, first-attempt recall, short-ref usage, per-read token cost) are computed from the session JSONL. `quotedVerbatim` is required only for log/error-line cases (`X01`, `H02`). Q05 / W-Q05 use semantic equivalence (`ZX-731`). `grade.sh` hashes protected paths in Python so Linux hosts without `shasum` still record `protectedIntact`. Candidate stub flags (`fold.stubHeadBytes` / `fold.stubTailBytes`) stay off unless a recall live meets the upgrade gate.

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

`--resume <runDir>` fills missing episode dirs only. Do not retune fold parameters and keep only the second run. Current evidence run: `review-r8-20260911b`. Contrasts: `20260909-103813` (L06 class-file wrong-action), `20260908-215433` (no verified read, no metrics). Round-7 pack backup: `artifacts/local-eval/review-final-r7-backup/`. Git tracks only `artifacts/local-eval/review-final/{REPORT.md,report.json,MANIFEST.sha256}`.

H03 episodes temporarily point `HOME` at a temp dir. Restore `HOME` before `grade.sh` so Docker still sees `~/.docker`.

## Packaging

```bash
pnpm build && node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```
