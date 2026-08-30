# T34 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t34.test.ts`
- `packages/contracts/src/index.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T34/**`
- `blockers/T34-scope-expansion.md`

Allowed Files remain:

- `packages/contracts/src/semantic.ts`
- `packages/runtime/src/semantic/port.ts`
- `packages/runtime/test/semantic/port.test.ts`

## Necessity

The mandated RED file and barrel exports cannot live in Allowed Files. Downstream packages compile `@pcr/contracts` / `@pcr/runtime` only through their public index. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `SemanticProposal` is a typed contract: `proposalId`, `sourceRefs`, `claims`, `continuityPatch`.
- `createSemanticProvider({ cursor, generate })` is fail-closed; `generate` is required and has no default model.
- `propose` parses untyped provider output into `SemanticProposal` only (no hidden reasoning).

## Alternatives rejected

- Reusing `@pcr/worker` proposal shapes as the v2 public contract.
- Defaulting `generate` to an in-memory stub.
- Returning untyped JSON from the port.
