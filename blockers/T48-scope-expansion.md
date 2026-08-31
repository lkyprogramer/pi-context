# T48 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t48.test.ts`
- `packages/benchmark/src/index.ts`
- `packages/benchmark/package.json`
- `artifacts/task-evidence/T48/**`
- `blockers/T48-scope-expansion.md`

Allowed Files remain:

- `tests/performance/**`
- `tests/fault/**`
- `packages/benchmark/src/performance/**`

## Necessity

Mandated RED file and barrel cannot live in Allowed Files.

## Interface and State Impact

- `createPerformanceLaneRunner({ workspaceId, routes, cache, clone })` is fail-closed.
- Natural-threshold requires host window fill and `compactReason: "threshold"`; 6.2k / `manual` / `keepRecent: 2000` are rejected (F023).
- `cacheEligibleRatio` / `cacheReadTokens` come from cache receipts, not probe-token delta (F026).
- `cloneBytes` comes from the clone port, not a fixture constant.

## Alternatives rejected

- Single live gate at ~6.2k tokens with keepRecent 2k.
- `cacheReadTokens = tokensBefore - tokensAfter`.
- Kernel `tests/performance/support.ts` `PerformanceReport` (different shape; not the v2 public path).
