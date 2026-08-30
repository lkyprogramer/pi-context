# T07 Scope Expansion Approval

## Requested Paths

- `packages/runtime/src/index.ts`
- `tests/tasks/t07.test.ts`
- `artifacts/task-evidence/T07/**`
- `blockers/T07-scope-expansion.md`

## Necessity

T07 requires the RuntimeSession contract to compile from the public `@pcr/runtime` package. That package exports only `packages/runtime/src/index.ts`, but the task's Allowed Files list omits the index. The target-specific test and evidence paths are separately mandated by the task protocol.

## Interface Impact

`@pcr/runtime` publicly exports the T07 ports, RuntimeSession types, error, application service, and factory. No store, reducer, Pi adapter, lifecycle, or compaction implementation is added.

## Alternatives Rejected

- Source-relative imports do not prove the downstream public package contract.
- Deferring the export leaves T08 without an authorized RuntimeSession API.
- Editing the signed audit package would invalidate its manifest.

## Approval

Approved under the user's repository-wide goal to complete the referenced rearchitecture plan, including the necessary implementation, tests, and validation. The expansion is local-only and does not authorize push, publication, or deployment.
