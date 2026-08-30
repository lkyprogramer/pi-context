# T15 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t15.test.ts`
- `packages/runtime/src/index.ts`
- `packages/storage-node/src/index.ts`
- `packages/storage-node/src/schema/migrations.ts`
- `packages/storage-node/test/saga-store.test.ts`
- `packages/storage-node/test/user-turn-store.test.ts`
- `artifacts/task-evidence/T15/**`
- `blockers/T15-scope-expansion.md`

Allowed Files remain:

- `packages/runtime/src/evidence-service.ts`
- `packages/storage-node/src/evidence-repository.ts`
- `packages/storage-node/src/fts-index.ts`
- `tests/acceptance/evidence-recovery.test.ts`

## Necessity

The four-file boundary cannot:

1. Host the task-mandated RED file `tests/tasks/t15.test.ts`.
2. Export `createEvidenceService` from `@pcr/runtime` or the FTS/repository openers from `@pcr/storage-node` so a downstream consumer compiles against the public interface.
3. Append an immutable V5 FTS5 catalog without editing the T09/T11 migration list. Creating the virtual table ad hoc in `fts-index.ts` would escape checksummed schema history the same way T11 rejected ad hoc `saga_journal`.
4. Keep T11/T12 store tests that still assert the applied schema version is exactly 4.

Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `@pcr/runtime` owns `EvidenceService` and the admit/search/read ports. Production construction requires cursor, repository, FTS index, and blob store; missing ports fail closed.
- `@pcr/storage-node` exports `openWorkspaceEvidenceRepository` and `openWorkspaceEvidenceFtsIndex`, both requiring an already-open T09 `WorkspaceSqliteEvidenceStore`.
- V5 appends `evidence_fts` without changing frozen V1–V4 SQL or checksums.
- Exact read decrypts the admitted CAS blob and compares SHA-256 plus byte length. Search is scoped FTS5, not an in-memory fake.

## Alternatives rejected

- Indexing inside `packages/kernel` `FtsCatalog`: that catalog is in-process and not the T09 workspace SQLite.
- A second SQLite opener for FTS: would bypass T09 single-writer ownership.
- Creating the FTS virtual table outside `schema/migrations.ts`: escapes immutable migration history.
- Wiring T15 into T13 `ObservationService` or Pi tools: T20/T28 own retrieval tools and hook integration.
