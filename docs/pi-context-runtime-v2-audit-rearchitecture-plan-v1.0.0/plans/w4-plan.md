# W4 Plan

## Exit Condition

Optional semantic candidate is evidence-cited, verified, fenced and never required for correctness.

| Task | Deliverable | Depends on |
|---|---|---|
| [T34](../tasks/T34-semantic-proposal-contracts-and-provider-port.md) | Semantic proposal contracts and provider port | T03, T29 |
| [T35](../tasks/T35-evidence-cited-semantic-proposer.md) | Evidence-cited semantic proposer | T34 |
| [T36](../tasks/T36-deterministic-semantic-verifier-and-patcher.md) | Deterministic semantic verifier and patcher | T18, T22, T35 |
| [T37](../tasks/T37-durable-background-candidate-and-generation-fencing.md) | Durable background candidate and generation fencing | T09, T32, T36 |
| [T38](../tasks/T38-cache-adjusted-economics-controller.md) | Cache-adjusted economics controller | T25, T26, T37 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
