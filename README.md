# pi-context

Native-first history plugin for official Pi **0.85.1**. Package `pi-context@6.1.0` (`private: true`). Do not `npm publish`.

Default profile is **observe**: index native history and expose the `pctx_history` search/read tool. Bytes sent to the provider stay unchanged except for that extra tool schema.

`balanced` is a threshold fold of old exposed tool results. It is **default-off, trial in this environment** (local-eval `20260909-112407` → `decision: limited-balanced-trial`). The default profile stays `observe`. Enable balanced only with an explicit trusted `pctx.json`.

Unique packed entry: `src/extension.ts` → `dist/extension.js`. Config is `pctx.json` with `schemaVersion: 6`.

## Requirements

- Official Pi CLI `@earendil-works/pi-coding-agent@0.85.1` (workspace `node_modules` is enough if `pi` is not on PATH)
- pnpm `10.15.0`
- Node `>=22.19.0` for the grader image and `package.json` engines. The current host may be `v22.17.0` (warning only)

## Install

```bash
pnpm install
pnpm build
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```

Current tarball digest is in [`docs/iterations/native-first-v6.md`](docs/iterations/native-first-v6.md) (`36c1019d…`). Official Pi extracts to `~/.pi/agent/npm/node_modules/pi-context/dist/extension.js`. Do not pass the raw `.tgz` as a local extension path.

Or load the built file without packing:

```bash
pi -e ./dist/extension.js
```

Uninstall: `pi uninstall npm:pi-context@file:$PWD/pi-context-6.1.0.tgz`. Native Pi session files are not deleted.

## Config

`~/.pi/agent/pctx.json` always applies. `<cwd>/.pi/pctx.json` applies only when the host reports the project as trusted.

```json
{ "schemaVersion": 6, "profile": "observe" }
```

To try balanced (trial here, still default-off):

```json
{ "schemaVersion": 6, "profile": "balanced" }
```

Then confirm `/pctx status` shows `resolvedProfile=balanced`. Fold defaults stay `60 / 40 / 4 / 4096 / 1024 / 120`. Do not retune them to chase a later eval run.

`/pctx profile <p>` changes the in-memory profile only. It does not write `pctx.json`.

## `/pctx` commands

| Command | Effect |
|---|---|
| `/pctx status` | `resolvedProfile`, `configHash`, `configSource`, `warnings`, `hostVersion`, `contextWindow`, `contextPercent` |
| `/pctx status --json` | same view as JSON (also writes `pctx-status.json` under the agent dir) |
| `/pctx profile observe\|balanced\|off` | in-memory only |
| `/pctx doctor` | host/profile sanity line |
| `/pctx fold` | ask balanced to plan a fold if the trigger is met |
| `/pctx search` / `/pctx read` | tells you to use the `pctx_history` tool |

Load failures force `observe`, keep the error in `warnings`, and notify once. History read still works when the search index is down.

## Tests

Contract and official-host smoke (no live model):

```bash
pnpm smoke
pnpm typecheck
pnpm exec vitest run --config vitest.config.ts
```

Live matrix (37 episodes, existing model, Docker grader) lives in `eval/local/`. Do not commit `.env`, `eval/local/seeds/*.secret`, or `artifacts/local-eval/`.

```bash
pnpm eval:report artifacts/local-eval/20260909-112407
```

Quality / mechanism / cost all passed on that run. H02 lost evidence after fold is a 6.2 candidate (`post-compaction-evidence-delta`). H03 did not reach the 60% trigger. This stack often reports `cacheRead > input`; cost uses engine `prefillTokensDelta` from authenticated `/metrics`, not `usage.cacheRead`.

## Docs

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/INSTALL.md`](docs/INSTALL.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/iterations/native-first-v6.md`](docs/iterations/native-first-v6.md) — task log and current decision
- [`eval/local/README.md`](eval/local/README.md) — live harness
- [`docs/pi-context-native-first-audit-v6.0.0/`](docs/pi-context-native-first-audit-v6.0.0/README.md) — 6.1 design pack (historical plan; code and decision are in this repo)
