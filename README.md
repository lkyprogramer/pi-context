# pi-context

Native-first evidence context plugin for official Pi **0.85.1** (`pi-context@5.0.0-dev.0`, `private: true`).

Unique packed entry: `src/extension.ts` → `dist/extension.js`. The patched PCR 0.84.4 workspace (`apps/`, `packages/`, `patches/`) has been **removed from this tree**. Historical notes: [docs/SUPERSEDED-PCR.md](docs/SUPERSEDED-PCR.md).

## Install (verified)

```bash
nvm use v22.19.0
pnpm install
pnpm exec tsc -p tsconfig.build.json
node scripts/packed-host.mjs
pi install npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz
```

Official Pi extracts the tarball to `~/.pi/agent/npm/node_modules/pi-context/dist/extension.js`. Do not pass the raw `.tgz` as a local extension path.

Uninstall: `pi uninstall npm:pi-context@file:$PWD/pi-context-5.0.0-dev.0.tgz`. Native Pi session files are **not** migrated and **not** deleted.

Default profile is `observe` (index/history only). `balanced` is opt-in. `experimental-semantic` is unsupported until T17/T18.

## Tests

```bash
pnpm exec vitest run --config vitest.config.ts
pnpm exec tsc --noEmit -p tsconfig.build.json
```

## Configuration, security, operations

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)
- [`docs/INSTALL.md`](docs/INSTALL.md)
- [`CHANGELOG.md`](CHANGELOG.md)

## Specs

- [`docs/pi-context-native-first-evolution-v5.0.0`](docs/pi-context-native-first-evolution-v5.0.0) — v5 native-first plugin
- [`docs/pi-context-runtime-greenfield-spec-v1.0.0`](docs/pi-context-runtime-greenfield-spec-v1.0.0) — superseded PCR product spec
- [`docs/pi-context-compression-benchmark-spec`](docs/pi-context-compression-benchmark-spec) — historical W1/W2 evaluation
