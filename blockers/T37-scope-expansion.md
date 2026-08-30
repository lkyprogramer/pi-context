# T37 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t37.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `packages/storage-node/src/index.ts`
- `packages/storage-node/src/schema/migrations.ts`
- `packages/storage-node/package.json`
- `artifacts/task-evidence/T37/**`
- `blockers/T37-scope-expansion.md`

Allowed Files remain:

- `packages/runtime/src/background/**`
- `packages/storage-node/src/candidate-repository.ts`
- `packages/runtime/test/background/**`

## Necessity

The mandated RED file and public barrels cannot live in Allowed Files. Durable SQLite requires a versioned workspace migration (T09 owner). Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `CandidateRepository.prepare/publish/stale` is the public contract: prepared → committed via head CAS, otherwise stale.
- `openWorkspaceCandidateRepository({ database })` is fail-closed and uses the owned workspace SQLite capability.
- `createCandidateKey` hashes cursor + `sourceHead` + `configFingerprint`. No in-memory default store.

## Alternatives rejected

- Keeping the worker in-memory dummy store as the product fence.
- Creating the candidate table outside `schema_migration`.
- Defaulting `prepare` to `{ phase: "prepared" }` without SQLite.
