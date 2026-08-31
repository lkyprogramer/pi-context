# T54 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t54.test.ts`
- `artifacts/task-evidence/T54/**`
- `blockers/T54-scope-expansion.md`

Allowed Files remain:

- `CHANGELOG.md`
- `docs/INSTALL.md`
- `docs/OPERATIONS.md`
- `release/**`
- `findings/**`

## Necessity

Mandated RED file cannot live in Allowed Files.

## Interface and State Impact

- `createReleasePublisher({ workspaceId, git, artifacts })` is fail-closed.
- `ReleaseManifest` hashes are observed from git commit, packed tarball, toolchain/pi locks, T49 gate bundle, and a recorded rollback drill — not fixture constants.
- Dirty tree cannot publish (content-addressed release requires a clean HEAD).
- Finding closure ledger at repo-root `findings/` only records F017/F029 with evidence hashes.

## Alternatives rejected

- Hand-editing a gate decision into CHANGELOG as the release proof.
- Publishing to npmjs (`pcrRelease.npmPublish` remains false).
- Closing every findings.json P0 in the plan tree (outside Allowed Files).
