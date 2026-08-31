# T46 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t46.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T46/**`
- `blockers/T46-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/scoring/integrity.ts`
- `packages/benchmark/test/scoring/integrity.test.ts`

## Necessity

Mandated RED file and barrel cannot live in Allowed Files.

## Interface and State Impact

- `createIntegrityScorer({ blobs })` is fail-closed; recovery reads actual bytes.
- `toolPairViolations` is counted from call/result ids, not hardcoded 0.
- `deterministicHashStable` requires two observed output hashes, not renderer theory.

## Alternatives rejected

- `recovered = !mustOmitLeak`.
- Hardcoded `toolPairViolation: 0` or single-run hash stability.
