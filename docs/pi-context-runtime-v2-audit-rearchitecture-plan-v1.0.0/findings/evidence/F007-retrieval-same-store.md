# F007 closure evidence

`registerRuntimeTools` no longer uses a throwing stub with fixed `ws_0123456789abcdef`.
Search/read/recall resolve cursor+EvidenceService from the same WorkspaceUserTurnOwner
(SQLite + FTS + encrypted CAS) as user-turn / tool_result.

- `packages/pi-adapter/src/tools/search.ts` `resolveRetrievalInput`
- `apps/pi-context-runtime/src/extension.ts` `resolve: (ctx) => userTurns.resolveTools(ctx)`
- `tests/acceptance/product-runtime-path.test.ts` (passed): search hits `ev_*` and exact-read verifies SHA-256 of admitted payload
