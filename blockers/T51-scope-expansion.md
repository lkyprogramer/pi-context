# T51 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t51.test.ts`
- `artifacts/task-evidence/T51/**`
- `blockers/T51-scope-expansion.md`

Allowed Files remain:

- `tests/acceptance/deterministic-mvp.test.ts`
- `scripts/gates/deterministic-mvp.mjs`

## Necessity

Mandated RED file cannot live in Allowed Files.

## Interface and State Impact

- `createMvpAcceptance({ workspaceId, vertical, recovery, w1, w2, findings })` is fail-closed.
- `MvpAcceptance` is observed from those ports: vertical/recovery booleans, W1 gate boolean, W2 decision string, `p0Open` count.
- F001/F002 close only when product inspect reports RuntimeSession + tool_result registration; remaining P0s are counted, not hardcoded 0.

## Alternatives rejected

- Returning `{ vertical: true, recovery: true, w1Gate: true, w2Decision: "adopt-pcr-compactor", p0Open: 0 }` as a fixture.
- Reusing `evaluateDeterministicMvpGate` fixture evidence as the v2 public verdict.
- Treating findings.json `"open"` status as the only P0 source without product inspect.
