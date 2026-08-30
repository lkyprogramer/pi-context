# T20 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t20.test.ts`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `packages/pi-adapter/src/commands/context.ts`
- `packages/pi-adapter/src/tools/status.ts`
- `packages/pi-adapter/test/runtime-tools.test.ts`
- `apps/pi-context-runtime/src/extension.ts`
- `packages/pi-adapter/src/tools/recall.ts`
- `tests/live-gate/verification.test.ts`
- `tests/compat/provider-payload-probe.test.ts`
- `artifacts/task-evidence/T20/**`
- `blockers/T20-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/tools/search.ts`
- `packages/pi-adapter/src/tools/read.ts`
- `tests/acceptance/retrieval-tools.test.ts`

## Necessity

The three-file boundary cannot:

1. Host the task-mandated RED file `tests/tasks/t20.test.ts`.
2. Export `createRetrievalTools` from `@pcr/pi-adapter`.
3. Register `context_read` next to the existing tools or pass an `EvidenceService` through `ToolsRuntime`.
4. Keep `runtime-tools` and the packaged extension loading after `createSearchTool` stops reading the in-memory `searchIndex`.

Per-session composition-root wiring of a live `EvidenceService` into every Pi session remains T28. T20 replaces the in-memory catalog with an explicit EvidenceService port; the extension registers tools against a fail-closed unbound port so load still succeeds.

## Interface and State Impact

- `createRetrievalTools({ cursor, evidence })` is the production constructor. Missing ports fail closed.
- `context_search` / `context_read` call `EvidenceService.search` / `read`. They do not scan `searchIndex` or `runtime.evidence` maps.
- `ToolsRuntime` gains required `cursor` + `evidence` for search/read construction.

## Alternatives rejected

- Leaving `searchIndex` as a silent fallback: that is the F007 mock backend.
- Opening SQLite inside the tool files: storage ownership stays in `@pcr/storage-node`.
- Wiring T15 into `registerProductionUserTurnRuntime` here: T28 owns session-scoped hook integration.
