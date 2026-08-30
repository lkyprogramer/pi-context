# T29 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t29.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T29/**`
- `blockers/T29-scope-expansion.md`

Allowed Files remain:

- `packages/runtime/src/compaction/snapshot.ts`
- `packages/runtime/test/compaction/snapshot.test.ts`

## Necessity

The mandated RED file and the public `@pcr/runtime` export of `createCompactionSnapshotAssembler` cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createCompactionSnapshotAssembler({ cursor, transaction, directives, continuity, claims, evidence })` is the production constructor. Every port is required; there is no default in-memory store or empty claims/pointers fallback.
- `assemble(request)` runs the four source reads inside `transaction.run` (same-transaction checkpoint source), then derives heads and `snapshotHash` from those records.
- Snapshot claims/pointers are empty only when the injected ports return empty, never because the assembler hard-codes them.

## Alternatives rejected

- Returning `state.checkpoint` / hardcoded `ctx_runtime` heads (F006).
- Defaulting missing claims or pointers to `[]` inside the constructor.
- Assembling outside a transaction port.
