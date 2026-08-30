# T11 Formal Review Attempt 1

Candidate: `66f5e45cfce9f424e943a6377a7b536463b38470`

Result: FAIL

- P1: correlation and host uniqueness omitted `config_fingerprint`, so a stale generation blocked replacement processing.
- P1: the package root exported the raw shared `DatabaseSync` capability.
- P2: toolchain evidence did not record the locked Node version and controller root/commit binding remained pending.
- P2: recovery tests did not close/reopen or exercise abrupt process exit.

Fix response:

- Added config generation to both scoped unique indexes and correlation lookups, plus stale-v1 to committed-v2 regression coverage.
- Moved the SQLite access bridge behind the package export map and added a public-surface assertion.
- Recorded Node, pnpm and Pi versions under the locked Node runtime.
- Added SIGKILL after `host_visible`, reopen recovery, and second-reopen zero-mutation replay coverage.

The reviewer performed read-only inspection only. HEAD/tree remained unchanged and the only pre-existing worktree item was the user-provided audit-plan directory.
