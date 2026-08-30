# T11 Formal Review Attempt 2

Candidate: `94c91af2ce6de86b21711c41770e20ac6ca7d7f0`

Result: FAIL

- P2: two operations in the same full scope and config could contend for one host ID. SQLite preserved the winner, but the loser surfaced `PCR_SAGA_STORAGE_FAILURE` instead of the stable `PCR_SAGA_HOST_CONFLICT` contract.

Fix response:

- `markHostVisible()` now checks the full-scope/config host owner inside the same immediate transaction before updating.
- Regression coverage proves the loser receives `PCR_SAGA_HOST_CONFLICT`, the winner remains `host_visible`, and the loser remains `runtime_durable` without revision or host binding pollution.

The reviewer performed read-only inspection only. HEAD/tree remained unchanged and the only pre-existing worktree item was the user-provided audit-plan directory.
