# T28 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t28.test.ts`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `tests/support/pi.ts`
- `tests/contract/pi-context-hook.test.ts`
- `apps/pi-context-runtime/src/extension.ts`
- `artifacts/task-evidence/T28/**`
- `blockers/T28-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/context-hook.ts`
- `tests/acceptance/context-hook.test.ts`

## Necessity

The public `registerContextHook(pi, registry)` signature is the T28 contract. The current hook takes a `PiRuntime` kernel adapter and stitches by original slots. Callers in the product entry, Pi harness, and contract tests must switch to `RuntimeSessionRegistry` or they keep shipping F008/F010/F035. The mandated RED file and package export updates cannot live in Allowed Files.

## Interface and State Impact

- `registerContextHook(pi, registry: RuntimeSessionRegistry)` is the shipped path.
- Context messages are wrapped with T24 `createMessageCodec` and materialized through `session.materialize`.
- The hook returns one zone-ordered Pi list reconstructed from envelopes (no `stitchContextMessages`, no zero-filled usage).
- `stitchContextMessages` remains exported for existing unit coverage of the old helper; the hook does not call it.

## Alternatives rejected

- Keeping `PiRuntime` + stitch as the product path.
- Defaulting missing assistant usage to zeros (F035).
- Hard-coding `directives: "keep"` in the hook (F008). Snapshot comes from the session factory.
