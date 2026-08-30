# T09 Scope Expansion Approval

## Requested Paths

- `packages/contracts/src/v2.ts`
- `packages/storage-node/src/index.ts`
- `package.json`
- `pnpm-lock.yaml`
- `tests/tasks/t09.test.ts`
- `artifacts/task-evidence/T09/**`
- `blockers/T09-scope-expansion.md`

## Necessity

T09's required `EvidenceRepository` refers to a shared `EvidenceRecord`, but the signed plan does not define that type and T15's runtime service cannot depend on the Node storage adapter. The canonical record therefore belongs in `@pcr/contracts`. The storage-node package currently exports nothing, so its public index must export the repository and migration contract for downstream compilation. The root test project needs a workspace dependency to resolve that public package. The task protocol separately mandates its target test and evidence paths but omits them from Allowed Files.

The plan also gives later T11/T15 storage files no permission to extend `schema/**`. T09 defines only the evidence schema justified by its produced interface; it does not invent underspecified Saga or FTS columns. Those later tasks must receive explicit schema scope expansion or a dedicated migration task before adding durable tables.

## Interface Impact

`@pcr/contracts` gains the canonical cursor-complete `EvidenceRecord`. `@pcr/storage-node` publicly exports `EvidenceRepository`, the SQLite implementation/open function, stable storage errors, and the immutable migration descriptor list.

## Alternatives Rejected

- Defining `EvidenceRecord` only in storage-node would invert the runtime/storage dependency for T15.
- Leaving `src/index.ts` unchanged would make the required downstream public interface unreachable and untyped.
- Reusing the legacy store would preserve the exact F014 hard-coded session/branch/source/authority/payload defect.
- Pre-creating speculative Saga/FTS schemas without their later contracts would freeze guessed persistence formats.

## Approval

Approved under the user's repository-wide goal to complete the referenced rearchitecture plan. This is a local-only expansion and does not authorize push, publication, deployment, or remote writes.
