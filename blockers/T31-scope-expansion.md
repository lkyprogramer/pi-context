# T31 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t31.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `packages/pi-adapter/src/index.ts`
- `packages/pi-adapter/package.json`
- `tests/support/pi.ts`
- `apps/pi-context-runtime/src/extension.ts`
- `artifacts/task-evidence/T31/**`
- `blockers/T31-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/compaction-hook.ts`
- `packages/runtime/src/compaction-service.ts`
- `tests/acceptance/compaction-fallback.test.ts`

## Necessity

The mandated RED file, public exports, product entry, and existing compaction harness must switch from `buildCheckpoint` / `{cancel:true}` to `prepareCompaction` → `CompactionDecision`. T29/T30 wiring cannot live only in Allowed Files.

## Interface and State Impact

- `registerCompactionHooks` calls `runtime.prepareCompaction`. Soft `native-fallback` returns `undefined` (Pi Native). Integrity `hard-stop` aborts and cancels. `pcr` stages a `PiCompactionResult`.
- `createCompactionService({ cursor, assembler, renderer, verifier })` assembles a T29 snapshot, renders/verifies T30 CheckpointV2, and never rewrites directive polarity or hard-codes `ctx_runtime` heads.
- Product `extension.ts` uses that service. Empty claims/pointers only if those ports return empty.

## Alternatives rejected

- Returning `{cancel:true}` on every rejected candidate (F013).
- Keeping kernel `{ polarity: "must-not" }` / empty claims / `dh_runtime` heads on the product path (F005/F006).
