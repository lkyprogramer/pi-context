# W1 Plan

## Exit Condition

Real Pi tool result reaches encrypted CAS, reducer, Evidence, Search and exact Read.

| Task | Deliverable | Depends on |
|---|---|---|
| [T07](../tasks/T07-runtime-ports-and-runtimesession-application-service.md) | Runtime ports and RuntimeSession application service | T03, T04 |
| [T08](../tasks/T08-production-composition-root-and-session-registry.md) | Production composition root and session registry | T05, T07 |
| [T09](../tasks/T09-per-workspace-sqlite-schema-and-migrations.md) | Per-workspace SQLite schema and migrations | T03, T04 |
| [T10](../tasks/T10-encrypted-content-addressed-blob-store.md) | Encrypted content-addressed blob store | T09 |
| [T11](../tasks/T11-cross-store-saga-and-idempotency.md) | Cross-store Saga and idempotency | T09, T10 |
| [T12](../tasks/T12-exact-user-input-ledger-and-pi-correlation.md) | Exact user input ledger and Pi correlation | T05, T08, T09, T11 |
| [T13](../tasks/T13-real-pi-tool-result-ingress.md) | Real Pi tool_result ingress | T05, T08, T10, T11 |
| [T14](../tasks/T14-reducer-registry-and-production-reducers.md) | Reducer registry and production reducers | T13 |
| [T15](../tasks/T15-evidence-admission-fts-indexing-and-exact-read.md) | Evidence admission, FTS indexing and exact read | T09, T10, T13, T14 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
