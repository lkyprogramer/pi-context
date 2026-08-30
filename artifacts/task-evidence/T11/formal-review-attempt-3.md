# T11 Formal Review Attempt 3

Candidate: `762bba63c955f6fb0054969ece473cc2a97214c6`

Result: FAIL

- P2: snapshot recovery could still collide with a host ID owned by another operation and surface `PCR_SAGA_STORAGE_FAILURE`.

Fix response:

- `reconcile()` now preflights every new host binding against its full scope/config owner before applying any transition.
- Host conflicts return a transaction outcome and are converted to `PCR_SAGA_HOST_CONFLICT` outside the SQLite callback, avoiding generic storage-error remapping.
- The regression test drives both `markHostVisible()` and snapshot-recovery contention and proves the transaction leaves both records and revisions unchanged.

The reviewer performed read-only inspection only. HEAD/tree remained unchanged and the only pre-existing worktree item was the user-provided audit-plan directory.
