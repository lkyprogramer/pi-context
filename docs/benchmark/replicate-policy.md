# Replicate and arm schedule

Seed is a bound sampling/session/workspace input, not a loop label.

- If the Provider accepts a sampling seed, `bindReplicate` requires `sampling.seed === seed` (`seedMode=provider-sampling`).
- If the Provider does not accept a seed, the runner repeats the call and records `seedMode=replicate-repeat`. It does not claim a seeded sample.
- A seed that only changes a report label is `PCR_REPLICATE_LABEL_ONLY`.
- Arms run serially (`DEFAULT_ARM_CONCURRENCY=1`). Order is a latin square over `B0,B1,B2,F0`.
- Cold and hot cache lanes are partitioned; a shared request id is `PCR_REPLICATE_CACHE_LANE_MIXED`.
- Queue events record enqueue/start/end and rate-limit delay. Overlapping arm intervals fail closed.
