# T19 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t19.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T19/**`
- `blockers/T19-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/continuity/**`
- `packages/runtime/src/continuity-service.ts`
- `packages/core/test/continuity/**`

## Necessity

The allowed directories cannot host the mandated RED file or export `ContinuityService` / `createContinuityService` from package roots. Evidence logs live outside Allowed Files by protocol.

No new SQLite migration: T09 owns the workspace DB. T19 persists through an injected `ContinuityStore` so the runtime constructor stays fail-closed without a second opener.

## Interface and State Impact

- `@pcr/core` exports `reduceContinuityRevision` and continuity types.
- `@pcr/runtime` exports `createContinuityService({ cursor, store })`.
- Task fronts occupy exactly one of active / parked / completed / superseded. Completed fronts do not reactivate without authenticated-user evidence.

## Alternatives rejected

- Default in-memory store in production constructors.
- Reusing kernel `reduceContinuityRevision` as the shipped v2 path: it uses HostSessionCursor, invents `cl_aaaaaaaa`, and silently no-ops illegal transitions.
- Adding a continuity table in this task: would edit T09 migrations.
