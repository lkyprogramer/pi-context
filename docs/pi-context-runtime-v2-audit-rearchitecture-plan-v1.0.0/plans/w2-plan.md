# W2 Plan

## Exit Condition

Authenticated user correction and tool evidence survive storage/restart; W1 vertical Gate executes product path.

| Task | Deliverable | Depends on |
|---|---|---|
| [T16](../tasks/T16-unicode-clause-segmentation-with-real-offsets.md) | Unicode clause segmentation with real offsets | T03, T12 |
| [T17](../tasks/T17-directive-extraction-with-exact-clause-fallback.md) | Directive extraction with exact-clause fallback | T16 |
| [T18](../tasks/T18-temporal-key-value-and-supersession-resolver.md) | Temporal key/value and supersession resolver | T17, T09 |
| [T19](../tasks/T19-continuity-and-task-front-state-machine.md) | Continuity and task-front state machine | T09, T15 |
| [T20](../tasks/T20-storage-backed-context-search-and-context-read.md) | Storage-backed context_search and context_read | T15 |
| [T21](../tasks/T21-proactive-recall-policy-and-leases.md) | Proactive recall policy and leases | T18, T19, T20 |
| [T22](../tasks/T22-tool-trust-and-action-authority-gate.md) | Tool trust and action authority gate | T13, T15 |
| [T23](../tasks/T23-deterministic-w1-vertical-acceptance-gate.md) | Deterministic W1 vertical acceptance gate | T12, T13, T14, T15, T20 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
