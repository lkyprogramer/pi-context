# T44 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t44.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T44/**`
- `blockers/T44-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/reader/**`
- `tests/live/reader-ceiling.test.ts`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files.

## Interface and State Impact

- `createReaderCeiling({ corpusId, cases })` is fail-closed.
- `evaluate` scores whether oracle expected values are witnessed in the full (uncompressed) trace.
- Invented values such as `7-tu-00` make `answerable: false` (F018 loss is oracle, not compressor).
- Optional `candidateText` yields `candidateRetention` against the full-context hits.

## Alternatives rejected

- Blaming the compressor when the expected value was never in the raw trace.
- Defaulting a fake case catalog.
