# T13 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t13.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `apps/pi-context-runtime/src/composition-root.ts`
- `patches/@earendil-works__pi-coding-agent@0.84.4.patch`
- `pnpm-lock.yaml`
- `compat/pi.lock.json`
- `apps/pi-context-runtime/package.json`
- `tests/contract/pi-tool-result-order.test.ts`
- `tests/compat/pi-version-contract.test.ts`
- `artifacts/task-evidence/T13/**`
- `blockers/T13-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/tool-result-hook.ts`
- `packages/runtime/src/observation-service.ts`
- `tests/acceptance/tool-result-flow.test.ts`

## Necessity

The three-file boundary cannot:

1. Host the task-mandated RED file `tests/tasks/t13.test.ts`.
2. Export `ObservationService` from the `@pcr/runtime` package root so a downstream consumer can compile against the public interface.
3. Reach the unique packaged Pi entry (`registerProductionUserTurnRuntime` / `bindClaimedRuntime`) without editing composition-root.
4. Make integrity failures a hard-stop: stock `ExtensionRunner.emitToolResult` records-and-swallows handler exceptions. T13 must patch that emitter to propagate, the same way T12 patched `emitInputResult`.
5. Keep the existing `pi-tool-result-order` contract test honest once production constructors reject default fake blob/saga.

Pi field mapping, CAS-before-project, and the observation service itself stay in Allowed Files. Production reducers remain T14.

## Interface and State Impact

- `ObservationService.ingest` is the production `ToolResultPort`.
- Raw tool text bytes are encrypted-CAS durable before saga prepare and before compact visible projection.
- `tool_result` handler errors abort the session and propagate to the patched host emitter.
- Publishable self-contained patched host distribution remains T52.

## Alternatives rejected

- Leaving fake default blob/saga in the hook: contradicts T13 non-goals.
- Relying on stock swallowed `tool_result` exceptions: contradicts the hard-stop contract.
- A second packaged extension entry: the product must keep a single `pi.extensions` path.
