# T11 Scope Expansion Approval

## Requested Paths

- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `packages/storage-node/src/index.ts`
- `packages/storage-node/src/internal/sqlite-access.ts`
- `packages/storage-node/package.json`
- `packages/storage-node/src/schema/migrations.ts`
- `packages/storage-node/src/sqlite-store.ts`
- `packages/storage-node/test/saga-store.test.ts`
- `packages/storage-node/test/sqlite-store.test.ts`
- `tests/tasks/t11.test.ts`
- `tests/tasks/t09.test.ts`
- `artifacts/task-evidence/T11/**`
- `blockers/T11-scope-expansion.md`

## Necessity

The task's Allowed Files cannot publish the required package-root interfaces or persist Saga rows in the existing per-workspace `runtime.sqlite`. T11 therefore adds an immutable V2 migration and obtains an opaque transactional capability from the already-open T09 evidence store. This preserves one owned `DatabaseSync` connection instead of bypassing T09's writer ownership with a second opener.

The task protocol separately requires its target test and evidence paths but omits them from Allowed Files. A storage-node adapter test is required to prove migration, shared-connection, crash, concurrency and SQLite error behavior; runtime-only tests cannot establish those claims.

## Interface and State Impact

- `@pcr/runtime` owns the platform-neutral Saga contracts and pure recovery planner.
- `@pcr/storage-node` exports `openWorkspaceSagaJournal`, which requires an actual `WorkspaceSqliteEvidenceStore` and an explicit Blob verifier. The raw SQLite capability remains package-private behind the root-only package export map.
- V2 appends `saga_journal` without changing the frozen V1 SQL or checksum.
- `prepare()` verifies the cursor-scoped CAS receipt before its atomic insert and returns `runtime_durable`; `prepared` is the in-transaction intent state, not a separately returned durable milestone.
- `configFingerprint` is an immutable fence alongside the complete cursor. `acknowledged` is persisted inside the same recovery transaction immediately before `committed`.

## Alternatives Rejected

- A JSON WAL lacks SQLite atomicity, fsync evidence and full cursor/config fencing.
- A second SQLite opener would bypass T09's single-writer ownership and complicate close/recovery ordering.
- Creating the Saga table ad hoc in `saga-store.ts` would escape immutable migration history.
- Reusing the legacy Saga would retain `branchScope=main`, overwrite conflicts into quarantine and fabricate Evidence receipts.

## Approval

Approved under the user's repository-wide goal. This remains local-only and does not authorize push, deployment, publication or remote writes.
