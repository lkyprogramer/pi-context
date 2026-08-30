# W3 Plan

## Exit Condition

Context and compaction paths use actual identity/budget/state, fallback Native, and survive three cycles.

| Task | Deliverable | Depends on |
|---|---|---|
| [T24](../tasks/T24-lossless-pi-message-envelope-codec.md) | Lossless Pi message envelope codec | T04, T05 |
| [T25](../tasks/T25-actual-model-budget-and-token-calibration.md) | Actual model budget and token calibration | T05, T24 |
| [T26](../tasks/T26-section-model-and-cache-receipt.md) | Section model and cache receipt | T18, T19, T21, T25 |
| [T27](../tasks/T27-budget-correct-materializer.md) | Budget-correct materializer | T24, T25, T26 |
| [T28](../tasks/T28-pi-context-hook-vertical-integration.md) | Pi context hook vertical integration | T08, T24, T27 |
| [T29](../tasks/T29-authoritative-compaction-snapshot-assembler.md) | Authoritative compaction snapshot assembler | T15, T18, T19 |
| [T30](../tasks/T30-deterministic-checkpoint-renderer-and-verifier.md) | Deterministic checkpoint renderer and verifier | T20, T29 |
| [T31](../tasks/T31-pi-compaction-takeover-with-native-fallback.md) | Pi compaction takeover with Native fallback | T05, T08, T30 |
| [T32](../tasks/T32-session-branch-and-restart-recovery.md) | Session, branch and restart recovery | T08, T11, T31 |
| [T33](../tasks/T33-recursive-compaction-and-long-session-boundedness.md) | Recursive compaction and long-session boundedness | T27, T31, T32 |

## Parallelism

Only Tasks whose `dependsOn` are committed and whose Allowed Files do not overlap may run concurrently. Integration Tasks at the end of the Wave are serial reviewer gates.
