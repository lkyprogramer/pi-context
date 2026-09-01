# Live Benchmark 通用 Runbook

## Lane 1：Boundary Replay

- Freeze JSONL、Runtime Store、Workspace；
- 同一个 cut/firstKept/tokensBefore；
- B0/B1/B2/F0 独立 Home/Workspace；
- 不并发运行 Arms，使用随机/拉丁方顺序；
- 保存 Artifact、Probe、Environment Continuation。

## Lane 2：Natural Threshold

- 使用真实 contextWindow、默认 reserve/keepRecent；
- auto compact 开启；
- 不调用 manual compact；
- 每轮记录 getContextUsage/request usage/compaction count；
- 一直增长到自动 threshold 或明确证明 Provider advertised window 不真实；
- 至少每 arm 一次 threshold，且触发前后任务闭环成功。

## Lane 3：Provider Overflow

- auto compact 关闭以制造真实 overflow；
- 必须捕获 Provider context-length error/HTTP/API code；
- 保存失败 request hash；
- 运行 compact/retry；
- retry hash 改变、effective tokens 严格下降；
- 最终任务成功，无无限循环。

手工 compact 后 retry 成功不等于 overflow recovery。

## Lane 4：Recursive Long Horizon

同一 Session 至少：

- 3 次 compaction；
- 2 个 task fronts；
- 1 次 correction/supersession；
- 1 次 branch；
- 1 次 restart；
- recall-needed + recall-not-needed；
- 1 个不可重复 side effect；
- 每轮都检查 active directive、pointer recovery、next safe action。

## Lane 5：Cache/Metadata

- 冷/热请求分开；
- 同 Provider/price table；
- 记录 cacheRead/cacheWrite、first different、input/output；
- 比较 full metadata/short-ref/no metadata；
- Hard/Quality 失败的配置不参与成本排名。
