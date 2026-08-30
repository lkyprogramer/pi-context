# T39 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t39.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `package.json`
- `pnpm-lock.yaml`
- `artifacts/task-evidence/T39/**`
- `blockers/T39-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/corpus/**`
- `benchmarks/manifest/**`
- `scripts/benchmark-lock.mjs`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files. Root `package.json` must declare `@pcr/benchmark` so downstream tests and `pnpm -r typecheck` resolve the public contract the same way they resolve `@pcr/runtime`. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createCorpusGovernor({ corpusId, store })` is fail-closed; no default corpus.
- `lock({ benchmarkMajor })` writes `CorpusManifest` with immutable train/dev/test hashes and cluster membership.
- Same major with a mutated holdout fails closed; a new major is required (F028).
- Splits are assigned per cluster so bootstrap is not 100 parameterized clones (F022).

## Alternatives rejected

- Hashing a flat 100-case list without clusters.
- Rewriting `lockedTestHash` in place after a gate failure.
- Defaulting an in-memory corpus inside the constructor.
