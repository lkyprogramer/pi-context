# T49 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t49.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T49/**`
- `blockers/T49-scope-expansion.md`

Allowed Files remain:

- `packages/benchmark/src/report/**`
- `scripts/run-gate.mjs`
- `packages/benchmark/test/report.test.ts`

## Necessity

Mandated RED file and barrel cannot live in Allowed Files.

## Interface and State Impact

- `createGateEngine({ workspaceId, git, files })` is fail-closed.
- `evaluate` is lexicographic: dirty tree → infrastructure fix; integrity fail → stop despite token savings; closed-loop quality uses environment success only (F019).
- `writeImmutableBundle` writes a content-addressed bundle (F029) and refuses a dirty/mismatched git snapshot (F030).

## Alternatives rejected

- Scoring closed-loop from summary ∪ probe.
- Hand-editing `decision` or gitignored `report.json` as the release artifact.
- Reusing `tests/w1-gate/scorer.ts` as the v2 public engine.
