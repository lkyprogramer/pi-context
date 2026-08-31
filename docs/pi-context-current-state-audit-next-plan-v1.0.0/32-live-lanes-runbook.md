# Live 测试运行手册

## Lane A：Boundary Replay

- 30 independent clusters × 3 seeds；
- same JSONL/store/workspace/cut；
- full raw artifacts retained。

## Lane B：Natural Threshold

- Pi 默认 keepRecent/reserve；
- 真实 200K context window；
- tools enabled；
- 自动 threshold，不手工 compact。

## Lane C：Provider Overflow

- 真实 provider 返回 overflow；
- 记录 failed payload hash、compaction/retry、new payload hash；
- 证明 progress 和无无限 retry。

## Lane D：Recursive Long Horizon

- ≥3 compactions；
- ≥2 task fronts；
- correction + branch + restart；
- recall-needed 与 recall-not-needed；
- external side effect；
- cache telemetry。

## Lane E：Fault/Security

- CAS fsync/crash/Saga orphan；
- corrupt blob/key rotation；
- cross-scope read；
- injection/secret variants；
- stale background candidate。
