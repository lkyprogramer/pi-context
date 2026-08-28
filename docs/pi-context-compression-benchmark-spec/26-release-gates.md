# Benchmark Package 发布门

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## Alpha

- Schemas/Examples/Validator；
- Pi Native Arm 可复现；
- RawTrace/Snapshot/Oracle hash；
- 12 synthetic CI scenarios。

## W1 Gate-ready

- A0/A1/A2；
- Recoverability、Recall needed/not-needed；
- Static + Token/Latency；
- 60 paired boundaries；
- machine-readable W1 decision。

## W2 Gate-ready

- B0/B1/B2；
- Reader-isolated；
- Paired closed-loop；
- 100 paired boundaries；
- non-inferiority 与 failure attribution。

## Publication-ready

- 150+ boundaries or power analysis；
- two Reader models；
- two Judge models + human calibration；
- external benchmark adapters；
- sealed test set；
- reproducible container/lock；
- complete raw result hashes。
