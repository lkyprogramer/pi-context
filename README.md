# pi-context

Native-first evidence context plugin for official Pi **0.85.1** (`pi-context@5.0.0-dev.0`, `private: true`).

The patched PCR 0.84.4 runtime is [superseded](docs/SUPERSEDED-PCR.md). Unique packed entry: `dist/extension.js`.

## Install (verified)

```bash
nvm use v22.19.0
pnpm exec tsc -p tsconfig.build.json
pi install ./pi-context-5.0.0-dev.0.tgz
```

Uninstall: `pi uninstall ./pi-context-5.0.0-dev.0.tgz` (or `pi remove` the listed source). Native session files are not migrated or deleted.

Default profile is `observe` (index/history only). `balanced` is opt-in. `experimental-semantic` is unsupported until T17/T18.

## Install and rollback (legacy PCR)

See [`docs/INSTALL.md`](docs/INSTALL.md). Historical path:

```bash
pi -e ./apps/pi-context-runtime/dist/extension.js
```

## Configuration, security, operations

- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)
- [`CHANGELOG.md`](CHANGELOG.md)

## Specs

- [`docs/pi-context-runtime-greenfield-spec-v1.0.0`](docs/pi-context-runtime-greenfield-spec-v1.0.0) — product implementation
- [`docs/pi-context-compression-benchmark-spec`](docs/pi-context-compression-benchmark-spec) — W1/W2 evaluation and gates

## Status

T45 stopped at the deterministic slice. Synthetic W1/W2 and informal live compact are **not** a publication claim that PCR is better than Pi Native.
