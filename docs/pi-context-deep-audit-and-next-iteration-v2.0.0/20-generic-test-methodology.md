# 通用 Agent Context/Memory 测试方法

## 1. 先定义系统层级

“原文还在”需要拆成五层：

1. 持久化存在；
2. 活跃 Context 可见；
3. 有稳定 Pointer；
4. 可检索/可恢复；
5. 压缩后行为等价。

报告必须逐层给证据，禁止用第 1 层代替第 5 层。

## 2. 四种测试对象

| 对象 | 问题 | 主要方法 |
|---|---|---|
| Artifact | 状态是否精确保留 | deterministic oracle / hash / refs |
| Reader | 模型能否从压缩视图答对 | isolated probe-only |
| Executor | 模型能否继续完成工作 | tools-enabled environment assertions |
| Economics | 在成功任务上是否更省 | paired full cost/latency/cache |

## 3. Arm 定义

```text
A0 Pi Native untouched
A1 Native + identical PCR ingress/CAS/reducers
A2 A1 + proactive recall

B0 A1-shaped + Pi Native compaction
B1 same trace/store/cut + PCR deterministic checkpoint
B2 B1 + PCR request materializer/recall
F0 full-context reader/executor ceiling
```

所有 Arm 共享同一个 Source Bundle，只改变待评估机制。

## 4. Hard Gate

- source-witness oracle validity = 100%；
- same source span/store/workspace/cut；
- active directive exact coverage = 100%；
- polarity/time/supersession = 100%；
- actual tool-pair violation = 0；
- CAS exact recovery = 100%；
- cross-scope read = 0；
- visible must-omit leak = 0；
- unsupported high-risk outcome = 0；
- deterministic hash stability = 100%；
- failures/exclusions fully accounted。

Hard Gate 失败后，不得用平均质量/效率覆盖。

## 5. Quality

- Environment task success；
- critical family no regression；
- cluster bootstrap 95% CI lower ≥ -0.02；
- Temporal/update/negation/abstention 单独报告；
- F0 answerable ceiling；
- Reader failure 与 Executor failure 分开。

## 6. Economics

只在同一 pair 两臂都成功时计算：

```text
realized_net = avoided_input
             + avoided_overflow/retry
             + cache benefit
             - summary cost
             - recall cost
             - cache rewrite cost
             - extra output/tool cost
             - latency penalty
             - failure penalty
```

报告中位数、P95、Cluster CI 和 cost per successful task。

## 7. 失败样本

- 不得删除；
- Infra failure 与 product failure 分开；
- 超时、rate limit、provider outage 保留原始日志；
- 排除条件预先定义；
- 报告 expected/completed/excluded/retried/failed 全部数量。
