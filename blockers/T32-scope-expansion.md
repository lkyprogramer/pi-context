# T32 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t32.test.ts`
- `packages/runtime/src/index.ts`
- `packages/runtime/package.json`
- `packages/pi-adapter/package.json`
- `apps/pi-context-runtime/src/extension.ts`
- `artifacts/task-evidence/T32/**`
- `blockers/T32-scope-expansion.md`

Allowed Files remain:

- `packages/pi-adapter/src/lifecycle.ts`
- `packages/runtime/src/recovery-service.ts`
- `tests/acceptance/restart-branch-recovery.test.ts`

## Necessity

The mandated RED file and public `@pcr/runtime` export cannot live in Allowed Files. Product `extension.ts` still no-ops lifecycle and snapshots `ws_012`/`s1`/`leaf-a` (F012). Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createRecoveryService({ cursor, sessions, journal, candidates })` is fail-closed.
- `onSessionStart` opens the registry session, reconciles the T11 journal, invalidates candidate fences, and returns catch-up plus saga actions.
- `onBranchChange` closes the previous session, opens the new cursor, and invalidates candidates.
- `registerSessionLifecycle` can bind a `RecoveryService` through `createLifecycleRuntimeFromRecovery`, deriving the cursor from Pi `cwd`/`sessionManager`.

## Alternatives rejected

- Keeping empty `openSession`/`switchBranch` on the product entry.
- Hard-coding `ws_0123456789abcdef` / `s1` / `leaf-a` for recovery identity.
- Default in-memory journal or candidate fence inside the constructor.
