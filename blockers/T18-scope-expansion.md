# T18 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t18.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T18/**`
- `blockers/T18-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/directives/temporal.ts`
- `packages/runtime/src/directive-service.ts`
- `packages/core/test/directives/temporal.test.ts`

## Necessity

The three-file boundary cannot host the mandated RED file or export `DirectiveResolver` / `createDirectiveService` from package roots. Evidence logs live outside Allowed Files by protocol.

No new SQLite migration: T09 already owns the workspace DB. T18 persists through an injected `DirectiveRecordStore` so the runtime constructor stays fail-closed without inventing a second opener.

## Interface and State Impact

- `@pcr/core` exports `createDirectiveResolver`, `parseTemporalAssignment`, and `DirectiveResolver`.
- `@pcr/runtime` exports `createDirectiveService`, which requires cursor + store.
- A later correction with the same key supersedes the previous active record. Values come from the user quote (`version 7` → `7`), not a derived `7-<case-id>`.

## Alternatives rejected

- Default in-memory store inside production constructors: contradicts fail-closed ports.
- Adding a directives table in this task: would edit T09 migrations outside Allowed Files.
- Rewriting polarity to must-not: F005.
