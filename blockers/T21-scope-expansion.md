# T21 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t21.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T21/**`
- `blockers/T21-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/retrieval/proactive.ts`
- `packages/runtime/src/lease-service.ts`
- `packages/core/test/retrieval/proactive.test.ts`

## Necessity

The allowed files cannot host the mandated RED file or export `ProactiveRecallPolicy` / `createLeaseService` from package roots. Evidence logs live outside Allowed Files by protocol.

No SQLite migration: T09 owns the workspace DB. T21 persists leases through an injected `LeaseStore` and searches through an injected `RecallCatalog`, so production constructors stay fail-closed without a second opener.

## Interface and State Impact

- `@pcr/core` exports `createProactiveRecallPolicy({ cursor, catalog, leases })` and `ProactiveRecallPolicy.decide`.
- `@pcr/runtime` exports `createLeaseService({ cursor, store, clock, limits })`.
- Decisions are `needed` (bounded page + inform-only lease) or `not-needed` (empty/recent/completed). Leases never escalate above `inform`.

## Alternatives rejected

- Default in-memory catalog or lease store in production constructors.
- Reusing kernel `buildProactiveRecallPage` / `LeaseStore` as the shipped v2 path: kernel invents `directive_${index}` evidence ids and keeps leases in a process Map.
- Wiring composition-root Recall tools here: that remains T28; T21 ships the policy/lease contract T20 search can later call.
