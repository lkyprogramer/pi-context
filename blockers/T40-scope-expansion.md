# T40 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t40.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T40/**`
- `blockers/T40-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/oracle/**`
- `packages/benchmark/test/oracle.test.ts`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `validateOracle(trace, oracle)` is fail-closed and pure: every exact expected value must appear as a contiguous witness in the raw trace.
- Invented values such as `7-tu-00` derived from `version 7` plus a case id are rejected (`ORACLE_VALUE_UNSUPPORTED_BY_WITNESS`).
- Optional `sourceRefs` must name trace entries that actually contain the value.
- Optional workspace/session on trace and oracle must match when both are present.

## Alternatives rejected

- Treating `7-${caseId}` as a legal deterministic derivation.
- Scoring assistant prose as a witness for a user-authored expected value.
- Defaulting an empty oracle to success.
