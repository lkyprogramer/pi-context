# T41 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t41.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T41/**`
- `blockers/T41-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/trace/**`
- `scripts/capture-trace.mjs`
- `packages/benchmark/test/trace.test.ts`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createTraceCapture({ corpusId, clusters, store })` is fail-closed; no default corpus or filesystem.
- `capture` redacts secrets from session JSONL and workspace snapshot, then hashes the redacted artifacts.
- `clusterId` must be a key from the T39 corpus clusters (F023 starts from locked real-cluster traces, not a 6.2k synthetic clone).
- CLI `scripts/capture-trace.mjs` launches the public capture path.

## Alternatives rejected

- Shipping unredacted session JSONL hashes.
- Accepting any cluster id outside the locked corpus.
- Defaulting an in-memory store in the constructor.
