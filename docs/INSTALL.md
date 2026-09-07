# Install

`pi-context@5.0.0-dev.0` is a **private** plugin tarball for official Pi 0.85.1. Do not `npm publish`.

## Requirements

- Node `>=22.19.0` (`nvm use v22.19.0`)
- Official Pi CLI `@earendil-works/pi-coding-agent@0.85.1`
- pnpm `10.15.0`

## Build and install

```bash
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
pi list
```

Do not load a raw `.tgz` as an extension path. Official Pi must extract `dist/extension.js`.

## Uninstall and data

```bash
pi uninstall npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

Native session JSONL files remain. There is no PCR→v5 data migration and no reverse migration.

The old PCR command `pi -e ./apps/pi-context-runtime/dist/extension.js` is retired; that path is gone from this tree.
