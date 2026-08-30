# T22 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t22.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `artifacts/task-evidence/T22/**`
- `blockers/T22-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/security/**`
- `packages/runtime/src/authorization-service.ts`
- `tests/security/authority.test.ts`

## Necessity

The allowed directories cannot host the mandated RED file or export `authorizeAction` / `createAuthorizationService` from package roots. Evidence logs live outside Allowed Files by protocol.

No SQLite migration: T22 is a pure trust/authority gate. Policy is injected; production constructors stay fail-closed without a default allowlist.

## Interface and State Impact

- `@pcr/core` exports `authorizeAction(input)` and trust types.
- `@pcr/runtime` exports `createAuthorizationService({ cursor, policy })`.
- Custom / MCP / external tools are always `untrusted-tool`. Builtin tools become `trusted-tool` only with an allowlisted name plus verified receipt. Granted authority never exceeds `sourceAuthorityCeiling`.

## Alternatives rejected

- Defaulting every `tool_result` to `trusted-tool` (F034).
- Reusing kernel `authorizeToolCall` as the shipped v2 path: it lives in `@pcr/kernel`, treats ambiguous tools as commands with injected fakes, and is not the public `authorizeAction` contract.
- Baking a built-in allowlist into production constructors.
