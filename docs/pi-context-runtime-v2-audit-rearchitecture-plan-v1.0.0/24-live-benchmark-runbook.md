# Live Benchmark Runbook

## Lane 1：Boundary Replay

用于快速定位某次压缩是否损坏状态；30 clusters × 3 seeds。

## Lane 2：Natural Threshold

使用真实模型原生窗口与默认 keepRecent/reserve，运行多轮 tool-heavy task 直到 threshold 自动触发。不得通过把 keepRecent 改成 2k 伪造生产 pressure。

## Lane 3：Provider Overflow

只使用 provider 真实 overflow；记录 failed request、retry、compaction、new request hash。

## Lane 4：Recursive Long Horizon

同一 session 至少 3 次 compaction、2 个 task fronts、一次 correction、一次 branch、一次 recall-needed 和一次 recall-not-needed。

## 运行要求

- clean git tree；
- container/image digest；
- model/provider/config hashes；
- independent workspace clone per arm；
- tools enabled；
- hidden continuation；
- immutable artifact bundle；
- 失败样本不得删除。
