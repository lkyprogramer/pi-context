# T45 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t45.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T45/**`
- `blockers/T45-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/continuation/**`
- `tests/live/closed-loop.test.ts`

## Necessity

Mandated RED file and barrel cannot live in Allowed Files.

## Interface and State Impact

- `createContinuationRunner({ corpusId, workspace, executor })` is fail-closed.
- Success is environment assertions only (file hash / command exit / forbidden tool), not summary text (F019).
- Executor must be able to call tools against a restored workspace snapshot (F024).

## Alternatives rejected

- Scoring yes/no model prose as closed-loop success.
- Defaulting a no-tools executor.
