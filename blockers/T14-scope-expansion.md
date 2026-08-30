# T14 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t14.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T14/**`
- `blockers/T14-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/reducers/**`
- `packages/core/test/reducers/**`

## Necessity

The two-directory boundary cannot host the task-mandated RED file `tests/tasks/t14.test.ts`, and cannot export the public `Reducer` / registry contract from `@pcr/core` without the package root. Evidence logs live outside Allowed Files by protocol.

T13 `ObservationService` stays on its pointer projection. T14 delivers the public production reducer registry for later tasks to inject; wiring it into the Pi hook is T28/T14-follow-on, not a silent T13 rewrite (T13 tests require visible content to omit raw secret bytes).

## Interface and State Impact

- `@pcr/core` exports `Reducer`, `ReducerInput`, `ReducerOutput`, `createReducerRegistry`, and `createProductionReducers`.
- Registry construction requires an explicit cursor and reducer list; missing deps fail closed.
- Unknown tools do not invent success: only an explicitly registered reducer may match.

## Alternatives rejected

- Implementing only inside kernel: T14 Allowed Files are `packages/core`.
- Changing T13 visible projection in this task: would break the T13 secret-omission contract.
