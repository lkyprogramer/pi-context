# Install

`pi-context@6.1.0` is a **private** plugin tarball for official Pi 0.85.1. Do not `npm publish`.

## Requirements

- Node `>=22.19.0` (`nvm use v22.19.0`). Host `v22.17.0` typechecks with an engines warning; the grader image is 22.19.0.
- Official Pi CLI `@earendil-works/pi-coding-agent@0.85.1` (workspace `node_modules` if `pi` is not on PATH)
- pnpm `10.15.0`

## Build and install

```bash
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
pi list
```

Do not load a raw `.tgz` as an extension path. Official Pi must extract `dist/extension.js`.

Default profile is `observe`. `/pctx status` should show `hostVersion=0.85.1` and `resolvedProfile=observe`.

Current tarball sha256 (rebuilt at the trial close): `36c1019d7e46864c5fc3cb5bff426ea178b4da6eba3f7563b5cf1d5ca372b1cd`. Rebuild after product changes; do not treat an old digest as the installed plugin.

`balanced` is default-off. This environment's eval decided `limited-balanced-trial` (`20260909-112407`). Opt in only with a trusted `pctx.json`.

## Uninstall and data

```bash
pi uninstall npm:pi-context@file:$PWD/pi-context-6.1.0.tgz
```

Native session JSONL files remain. There is no automatic migration from older config files and no reverse migration.
