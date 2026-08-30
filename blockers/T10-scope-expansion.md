# T10 Scope Expansion Approval

## Requested Paths

- `packages/contracts/src/v2.ts`
- `packages/contracts/src/types.ts`
- `packages/contracts/src/ids.ts`
- `packages/contracts/test/types.test.ts`
- `packages/contracts/schema-definitions.mjs`
- `packages/runtime/src/ports.ts`
- `packages/runtime/package.json`
- `packages/runtime/test/runtime-session.test.ts`
- `packages/storage-node/src/index.ts`
- `packages/storage-node/package.json`
- `packages/storage-node/src/sqlite-store.ts`
- `packages/storage/src/operations/key-rotation.ts`
- `packages/kernel/package.json`
- `tests/e2e/key-rotation-v2-boundary.test.ts`
- `tests/tasks/t09.test.ts`
- `tests/tasks/t08.test.ts`
- `tests/tasks/t07.test.ts`
- `tests/acceptance/session-registry.test.ts`
- `schemas/user-turn-record.schema.json`
- `schemas/evidence-receipt.schema.json`
- `tests/tasks/t10.test.ts`
- `artifacts/task-evidence/T10/**`
- `blockers/T10-scope-expansion.md`

## Necessity

T10's required public `BlobStore` interface refers to undefined `BlobRef` and `ByteRange` types. These types are consumed by runtime ingress/retrieval and therefore belong in `@pcr/contracts`, not only in the Node adapter. The storage-node public index must export the blob contracts and implementation for downstream compilation. The task protocol separately mandates its target test and evidence paths but omits them from Allowed Files.

Formal review also proved that a branded ref must survive the durable `rawBlobId` path and be revalidated when SQLite rows are decoded. The existing production key-rotation command targets the legacy envelope and must fail closed before touching a v2 CAS blob; implementing v2 rewrap remains outside T10.

The repository already has a legacy `artifacts/task-evidence/T10.json` for Directive capture. It remains immutable; the v2 graph uses the directory-scoped `artifacts/task-evidence/T10/evidence.json` plus `namespace.json`, and the v2 controller keeps its own status/evidence beneath the supplied audit-plan directory.

## Interface Impact

`@pcr/contracts` gains a durable, cursor-scoped `BlobRef` string alias and an end-exclusive `ByteRange`. `@pcr/runtime` owns the platform-neutral `BlobStore` port so later runtime services do not depend on the Node adapter. `@pcr/storage-node` publicly re-exports that port together with the explicit workspace key-provider contract, stable blob errors, and encrypted CAS constructor.

## Alternatives Rejected

- Reusing the legacy blob store would omit full cursor scope from both content identity and read authorization.
- Defining BlobRef only inside storage-node would force runtime/kernel consumers to depend on a platform adapter.
- Rename-overwrite publication is not safe under concurrent key rotation; T10 uses no-overwrite atomic publication.

## Approval

Approved under the user's repository-wide goal to complete the referenced rearchitecture plan. This is a local-only expansion and does not authorize push, publication, deployment, or remote writes.
