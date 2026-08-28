# pi-context

Pi Context Runtime (PCR) — host-agnostic context kernel with Pi as the first adapter.

Current packaged version: `0.1.0-alpha.1` (deterministic MVP). Semantic/Background exists in-tree but **`semanticDefault=off`**.

## Install and rollback

See [`docs/INSTALL.md`](docs/INSTALL.md). Short path from this repo:

```bash
pi -e ./apps/pi-context-runtime/dist/extension.js
```

Remove with `pi remove npm:pi-context-runtime`. Uninstall does not delete workspace data.

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
