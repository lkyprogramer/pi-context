# T53 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t53.test.ts`
- `artifacts/task-evidence/T53/**`
- `blockers/T53-scope-expansion.md`

Allowed Files remain:

- `compat/**`
- `.github/workflows/compatibility.yml`
- `tests/compat/**`

## Necessity

Mandated RED file cannot live in Allowed Files.

## Interface and State Impact

- `createCompatibilityMatrix({ workspaceId, lock, probe })` is fail-closed.
- `CompatibilityCell` status and evidence come from the probe, not hardcoded `pass`.
- `compat/toolchain.lock.json` is the Node/pnpm/OS matrix SSOT; Pi version stays in `compat/pi.lock.json`.
- PR `compatibility.yml` remains fast required checks; it must not invoke live 3-seed jobs (F038).

## Alternatives rejected

- Hardcoding every cell as `pass`.
- Running live 100×3 on pull_request.
- Leaving Node 26.5.1 undocumented relative to `pi.lock.json`.
