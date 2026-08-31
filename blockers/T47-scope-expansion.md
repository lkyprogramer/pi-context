# T47 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t47.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T47/**`
- `blockers/T47-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/statistics/**`
- `packages/benchmark/test/statistics.test.ts`

## Necessity

Mandated RED file and barrel cannot live in Allowed Files.

## Interface and State Impact

- `createClusterStatistics({ catalog })` is fail-closed; cluster membership comes from the locked catalog, not caller-invented ids.
- Cluster bootstrap resamples **clusters** with equal weight so parameterized clones are one sampling unit (F022).
- `ClusterBootstrapResult.pairs` is the raw pair count; `clusters` is the sampling-unit count.
- McNemar is computed from actual baseline/candidate booleans, not a hardcoded table.

## Alternatives rejected

- Pair-level bootstrap of 100 parameterized clones.
- `Math.random()` (non-replayable) or kernel `bootstrapMean` on flat samples.
