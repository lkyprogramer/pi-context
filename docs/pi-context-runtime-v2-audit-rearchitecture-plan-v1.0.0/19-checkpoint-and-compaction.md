# Checkpoint 与 Compaction

## Deterministic Checkpoint v2

必须包含：

- active exact directives；
- current temporal values 与 supersession；
- active/parked task fronts；
- unresolved errors 与 validation evidence；
- external side effects；
- exact evidence pointers；
- source snapshot hash 与 heads。

## Verifier

1. source snapshot/head 一致；
2. directive exact coverage；
3. polarity/status/time/supersession；
4. tool outcome attestation；
5. pointers 可读且 scope 正确；
6. must-shrink；
7. retained tail/tool pairing；
8. deterministic render hash two-run stable。

## Fallback

- candidate unavailable/rejected（soft）：Pi Native；
- overflow 且 deterministic checkpoint 可生成：PCR；
- integrity/security hard failure：abort；
- Semantic candidate 永远不是唯一 fallback。
