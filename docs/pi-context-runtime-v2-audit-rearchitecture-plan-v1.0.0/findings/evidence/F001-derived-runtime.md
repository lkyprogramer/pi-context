# F001
Product extension derives cursor from cwd/sessionManager, uses T27 materializer with live model limits, and wires user-turn/tool_result/retrieval to SQLite/FTS/CAS.
- apps/pi-context-runtime/src/extension.ts createExtensionContextRegistry
- apps/pi-context-runtime/src/composition-root.ts registerProductionUserTurnRuntime
- tests/acceptance/context-hook.test.ts
- tests/acceptance/product-runtime-path.test.ts
