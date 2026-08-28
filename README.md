# pi-context

Public specifications and W1 implementation for Pi context runtime and compression evaluation.

## Specs

- [`docs/pi-context-runtime-greenfield-spec-v1.0.0`](docs/pi-context-runtime-greenfield-spec-v1.0.0) — runtime greenfield spec
- [`docs/pi-context-compression-benchmark-spec`](docs/pi-context-compression-benchmark-spec) — compression comparison and Early Net Value Gate spec

## W1 implementation

TypeScript workspace (`pnpm test`, `pnpm typecheck`) covering:

- contracts, RawTrace capture, boundary snapshot, oracle validation
- A0 Pi Native arm and A1/A2 W1 ingress (CAS, reducers, evidence, exact/FTS, proactive recall)
- static / recoverability / recall scoring, paired continuation, economics, paired stats, corpus adapters
- machine-readable W1 Early Net Value Gate (`scripts/run-gate.mjs`)

W1 still uses Pi Native compaction. No W2 materializer is implemented. Gate decisions from fixture metrics are not a 60-boundary publication claim.
