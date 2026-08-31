# T50 Scope Expansion Approval

## Requested Paths

- `tests/tasks/t50.test.ts`
- `artifacts/task-evidence/T50/**`
- `blockers/T50-scope-expansion.md`

Allowed Files remain:

- `.github/workflows/live-benchmark.yml`
- `.github/workflows/nightly.yml`
- `scripts/ci/live-env.mjs`

## Necessity

Mandated RED file cannot live in Allowed Files.

## Interface and State Impact

- `createLiveCiEnv({ workspaceId, env, git })` is fail-closed; no default `process.env` in the constructor.
- `LiveCiPolicy` lists required secret *names*, concurrency, and artifact retention; secret *values* never appear in errors or logs.
- Dirty tree / non-empty diff hash is `PCR_LIVE_CI_DIRTY_TREE` (F030).
- Nightly and live workflows are schedule/manual + protected `environment: live`, not `pull_request` (F038).

## Alternatives rejected

- Running live 3-seed jobs on every PR via `pnpm test`.
- Defaulting missing provider keys from `~/.pi/agent/models.json`.
- Echoing secret values into gate logs.
