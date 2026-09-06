# Configuration

## Release profile

T45 stopped at the deterministic slice. T46 recorded `not-enabled-by-release-profile`.

- `semanticDefault=off`
- Do not turn Semantic/Background on without paired live evidence that covers stale cost.
- `publicationClaim` stays `false` until a later T42/T45 pairing against **Pi Native** compaction passes the efficiency gate.

## Product defaults

Do not copy live-gate isolation settings into product defaults:

- Isolated `maxTokens=256` is a smoke-test window only.
- Formal gates use the model’s real `maxTokens`.

## First run

The extension factory only registers handlers. After `session_start` the runtime can create `dataRoot`, keys, and store, then run doctor and claim the context owner.

## Feature flags

| Flag | Default | Notes |
|---|---|---|
| `PCR_RUNTIME_MODE` | `ingress` | `off` registers no mutating hooks. `ingress` observes/read-tools and keeps Pi Native context+compaction. `experimental-runtime` must be set explicitly to take over materialization and compaction. Illegal values throw `CONFIG_ERROR`. |
| semanticDefault / `PCR_SEMANTIC_BETA` | off | Background worker only when `PCR_SEMANTIC_BETA=1`. Quality-profile-only requires T45 continue **and** T46 stale-cost coverage |
| `PCR_EVAL_MATERIALIZER` | n/a | Eval-arm identity vs PCR materializer. Not a product runtime-mode switch. |
| publicationClaim | false | Report field only. Synthetic W1/W2 and informal live compact are not publication evidence and must not enable experimental-runtime |
