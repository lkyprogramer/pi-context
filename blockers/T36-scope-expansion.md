# T36 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t36.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T36/**`
- `blockers/T36-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/verifier/**`
- `packages/core/test/verifier/**`

## Necessity

The mandated RED file and public `@pcr/core` export cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createSemanticVerifier({ cursor })` is fail-closed and bound to one cursor.
- `verify(proposal, snapshot)` is a deterministic gate: citations must be in `snapshot.sourceRefs`, empty claims fail, and `must-not` rewrites of live directives fail (F005).
- Uncited claims are dropped by the deterministic patcher; polarity rewrites are terminal and not patched away.

## Alternatives rejected

- Hard-coding `{ ok: true }` without inspecting proposal citations.
- Rewriting directive polarity to `must-not` in the verifier.
- Default in-memory snapshot inside the constructor.
