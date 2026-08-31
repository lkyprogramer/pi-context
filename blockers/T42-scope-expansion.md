# T42 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t42.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T42/**`
- `blockers/T42-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/arms/w1.ts`
- `tests/live/w1-paired.test.ts`

## Necessity

The mandated RED file and `@pcr/benchmark` barrel cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createW1ArmRunner({ corpusId, manifest, cursor, cases, ingress, recall })` is fail-closed.
- `run(caseId, arm, seed)` replays the same locked RawTrace for A0/A1/A2.
- A0 is pass-through ingress; A1/A2 share W1 CAS+reducer ingress; all three record `compactor: "pi-native"` (F025).
- The runner copies `lockedTestHash` from the T39 manifest and does not rewrite corpus cases (F028).

## Alternatives rejected

- Deriving A1/A2 from an A0 compressed session.
- Mixing PCR checkpoint into the W1 arm comparison.
- Mutating locked holdout text to manufacture ingress delta.
