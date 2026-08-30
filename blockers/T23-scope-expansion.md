# T23 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t23.test.ts`
- `artifacts/task-evidence/T23/**`
- `blockers/T23-scope-expansion.md`

Allowed Files remain:

- `tests/acceptance/w1-vertical.test.ts`
- `scripts/gates/w1-vertical.mjs`

## Necessity

The two-file boundary cannot host the task-mandated RED file `tests/tasks/t23.test.ts`. Evidence logs live outside Allowed Files by protocol.

The gate script is the public constructor. The acceptance test is the consumer. `t23.test.ts` only drives those exports.

## Interface and State Impact

- `runW1Vertical` requires cursor, observation, evidence, blobs, and raw tool text. Missing ports fail closed.
- Evidence is `{ rawHash, visibleTokens, exactReadHash, searchRank }` from CAS bytes, T14 visible projection, T15/T20 exact read, and FTS rank.
- Per-session composition-root wiring remains T28.

## Alternatives rejected

- Reusing kernel `FtsCatalog` / in-memory W1 arms as the vertical: that is the F007/F020 mock path.
- Opening SQLite inside the gate without injected ports: production constructors must take stateful deps explicitly.
