# pi-context

Native-first history plugin for official Pi **0.85.1**. Package `pi-context@6.1.0` (`private: true`).

Default profile is **observe**: index native history and expose `pctx_history` search/read. Provider bytes stay unchanged except for that extra tool schema.

`balanced` threshold fold is **default-off, trial in this environment** (local-eval `20260909-112407` → `decision: limited-balanced-trial`). Default profile stays `observe`. Enable balanced only with an explicit trusted `pctx.json`.

Config is `pctx.json` with `schemaVersion: 6`. Unique packed entry: `src/extension.ts` → `dist/extension.js`.

## Install

```bash
pnpm install
pnpm build
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```

Or load the built file without packing:

```bash
pi -e ./dist/extension.js
```

Official Pi extracts the tarball to `~/.pi/agent/npm/node_modules/pi-context/dist/extension.js`. Do not pass the raw `.tgz` as a local extension path.

Uninstall: `pi uninstall npm:pi-context@file:$PWD/pi-context-6.1.0.tgz`. Native Pi session files are not deleted.

## `/pctx` commands

| Command | Effect |
|---|---|
| `/pctx status` | `resolvedProfile`, `configHash`, `configSource`, `warnings`, `hostVersion`, `contextWindow`, `contextPercent` |
| `/pctx status --json` | same view as JSON (also writes `pctx-status.json` under the agent dir) |
| `/pctx profile observe\|balanced\|off` | in-memory only; does not write `pctx.json` |
| `/pctx doctor` | host/profile sanity line |
| `/pctx fold` | ask balanced to plan a fold if the trigger is met |
| `/pctx search` / `/pctx read` | tells you to use the `pctx_history` tool |

Enable history from `pctx.json`:

```json
{ "schemaVersion": 6, "profile": "observe" }
```

To try balanced (trial here, still default-off): set `"profile": "balanced"` in a trusted `pctx.json`, then confirm `/pctx status` shows `resolvedProfile=balanced`.

## Tests

```bash
pnpm smoke
pnpm typecheck
pnpm exec vitest run --config vitest.config.ts
```

## Docs

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/iterations/native-first-v6.md`](docs/iterations/native-first-v6.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/INSTALL.md`](docs/INSTALL.md)
