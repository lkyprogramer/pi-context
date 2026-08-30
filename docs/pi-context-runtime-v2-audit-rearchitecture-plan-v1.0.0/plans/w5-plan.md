# W5 Plan

## Exit Condition

Locked corpus, valid Oracle, environment continuation and immutable report produce reproducible decisions.

| Task | Deliverable | Depends on |
|---|---|---|
| [T39](../tasks/T39-benchmark-corpus-governance-and-locked-splits.md) | Benchmark corpus governance and locked splits | T01 |
| [T40](../tasks/T40-oracle-source-witness-validator.md) | Oracle source-witness validator | T39 |
| [T41](../tasks/T41-real-trace-capture-and-anonymization.md) | Real trace capture and anonymization | T12, T13, T39 |
| [T42](../tasks/T42-w1-a0-a1-a2-live-arm-runner.md) | W1 A0/A1/A2 live arm runner | T23, T39, T40, T41 |
| [T43](../tasks/T43-w2-b0-b1-b2-live-arm-runner.md) | W2 B0/B1/B2 live arm runner | T31, T33, T39, T40, T41 |
| [T44](../tasks/T44-full-context-reader-ceiling.md) | Full-context reader ceiling | T40, T41 |
| [T45](../tasks/T45-workspace-closed-loop-continuation-runner.md) | Workspace closed-loop continuation runner | T41, T42, T43 |
| [T46](../tasks/T46-observed-integrity-and-recovery-scorers.md) | Observed integrity and recovery scorers | T15, T30, T40 |
| [T47](../tasks/T47-cluster-aware-paired-statistics.md) | Cluster-aware paired statistics | T39, T45, T46 |
| [T48](../tasks/T48-performance-cache-and-fault-lanes.md) | Performance, cache and fault lanes | T27, T32, T38, T43 |
| [T49](../tasks/T49-immutable-report-and-gate-engine.md) | Immutable report and gate engine | T42, T43, T44, T45, T46, T47, T48 |
| [T50](../tasks/T50-scheduled-live-ci-and-protected-credentials.md) | Scheduled live CI and protected credentials | T49 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
