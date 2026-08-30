# T38 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t38.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T38/**`
- `blockers/T38-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/economics/**`
- `packages/runtime/src/economics-service.ts`
- `tests/performance/economics.test.ts`

## Necessity

The mandated RED file and public barrels cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `RealizedNet` is priced currency, not a raw token delta.
- `createEconomicsController({ cursor, cache, prices, routes })` is fail-closed; no default prices.
- Failed tasks zero avoided-input/overflow benefits and charge `failureCost`.
- `cacheRewrite` is priced tokens after the cache receipt's eligible prefix.

## Alternatives rejected

- Reusing kernel `calculateRealizedNetValue` probe-token arithmetic as the public v2 controller.
- Defaulting prices to `1`.
- Ignoring T26 cache receipts (`previous=null` rewrite of the whole view).
