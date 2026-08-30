# T30 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t30.test.ts`
- `packages/core/src/index.ts`
- `packages/core/package.json`
- `artifacts/task-evidence/T30/**`
- `blockers/T30-scope-expansion.md`

Allowed Files remain:

- `packages/core/src/compaction/**`
- `packages/core/test/compaction/**`

## Necessity

The mandated RED file and the public `@pcr/core` export of `createCheckpointRenderer` / `createCheckpointVerifier` cannot live in Allowed Files. Evidence logs live outside Allowed Files by protocol.

## Interface and State Impact

- `createCheckpointRenderer({ cursor })` maps a T29 `CompactionSnapshot` to `CheckpointV2` without rewriting directive kind/polarity/status.
- `createCheckpointVerifier({ cursor, pointers })` checks snapshotHash, preserved directives, claims/pointers/heads, and pointer reachability. Two verifies of the same candidate yield the same `outputHash`.
- `CompactionSnapshot` is a structural type in core so `@pcr/core` does not import `@pcr/runtime`.

## Alternatives rejected

- Rewriting every directive to `must-not/active` (F005).
- Returning `state.checkpoint` / hardcoded heads (F006).
- Treating renderer determinism as proven without a second-run `outputHash` (F021).
