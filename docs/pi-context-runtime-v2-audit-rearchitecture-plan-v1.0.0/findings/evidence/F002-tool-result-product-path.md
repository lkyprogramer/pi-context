# F002 closure evidence

Product entry `registerProductionUserTurnRuntime` registers `tool_result` and now admits
reducer facts into the workspace SQLite/FTS/CAS used by retrieval tools.

- `apps/pi-context-runtime/src/composition-root.ts` `registerToolResultHook` + observation `ingest` → `evidence.admit`
- `tests/acceptance/tool-result-flow.test.ts` product extension emitToolResult
- `tests/acceptance/product-runtime-path.test.ts` emitToolResult then context_search/context_read
