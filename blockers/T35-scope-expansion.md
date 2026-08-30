# T35 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t35.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T35/**`
- `blockers/T35-scope-expansion.md`

Allowed Files remain:

- `packages/runtime/src/semantic/proposer.ts`
- `packages/runtime/test/semantic/proposer.test.ts`

## Necessity

The mandated RED file and public `@pcr/runtime` export cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createSemanticProposer({ cursor, evidence, provider })` is fail-closed.
- `propose(input, signal)` loads source refs from the injected evidence catalog, then asks the T34 provider for a typed `SemanticProposal`.
- Empty catalogs, empty claims, and citations outside the catalog fail closed. No default evidence or generate.

## Alternatives rejected

- Inventing `sourceRefs` inside the proposer.
- Treating empty `{}` generate output as an evidence-cited success.
- Default in-memory catalog or provider inside the constructor.
