# F003 closure evidence

`registerToolResultHook` maps live `ToolResultEvent` fields `toolCallId/toolName/input/content/details/isError`.
No hardcoded operationId/toolCallId/toolName.

- `packages/pi-adapter/src/tool-result-hook.ts`
- `tests/acceptance/tool-result-flow.test.ts`
- `tests/tasks/t13.test.ts`
