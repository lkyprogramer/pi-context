# T26 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t26.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T26/**`
- `blockers/T26-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/materialization/sections.ts`
- `packages/core/src/materialization/cache.ts`
- `packages/core/test/materialization/cache.test.ts`

## Necessity

The allowed files cannot host the mandated RED file or export `SectionPlan` / `createSectionPlanner` / `createCacheReceipt` from the package root. Evidence logs live outside Allowed Files by protocol.

No SQLite migration: T26 persists the previous view receipt through an injected `CacheReceiptStore`. Production constructors require cursor, token pricer, and store.

## Interface and State Impact

- `@pcr/core` exports `createSectionPlanner({ cursor, pricer })` and `createCacheReceipt({ cursor, store })`.
- `SectionPlan.contentHash` is a hash of kind + zone + message bodies, not a kind-only stub.
- Cache receipts compare the previous committed section hashes to emit `firstDifferentSection` and prefix token reuse. `previous=null` is only the first commit.

## Alternatives rejected

- Kernel `buildCachePlan(..., previous=null)` as the shipped v2 path.
- Hashing only `sectionOrder` kinds (cannot detect same-kind content drift).
- Default in-memory receipt store or default token pricer in production constructors.
