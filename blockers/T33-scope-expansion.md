# T33 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t33.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T33/**`
- `blockers/T33-scope-expansion.md`

Allowed Files remain:

- `packages/runtime/src/compaction/retention.ts`
- `tests/acceptance/recursive-compaction.test.ts`

## Necessity

The mandated RED file and public `@pcr/runtime` export cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createRetentionController({ cursor, compaction, budgetTokens, inboundTokensPerCycle })` is fail-closed.
- `run` executes at least three recursive compaction cycles and returns `BoundednessReport`.
- Active tokens are the PCR summary plus inbound content retained under the injected budget (not a 2k keepRecent fixture).

## Alternatives rejected

- Scoring a hardcoded `{ passed: true }` report.
- Using keepRecent=2k as a fake production pressure window.
- Default in-memory compaction inside the constructor.
