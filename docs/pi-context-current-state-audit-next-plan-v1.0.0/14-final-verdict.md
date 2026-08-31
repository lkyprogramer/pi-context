# 最终结论与允许声明

## 产品决策

```text
Default compactor: Pi Native
PCR ingress/CAS/reducer: continue validation
PCR deterministic checkpoint: experimental/shadow only
PCR B2 materializer/recall: not release-proven
Semantic/background: default-off
Release: blocked by current CI
```

## 允许写

- 当前项目已经从 fixture prototype 演进为具备真实存储/Ingress/Core 模块的 Alpha。
- 在一次 30-pair manual spec-smoke 中，PCR checkpoint artifact 更短、生成更快、没有复制 must-omit 字符串，并保持 literal directive。
- 规格 Gate 的当前决策是 keep-pi-native，publicationClaim=false。

## 禁止写

- PCR 已整体优于 Pi Native；
- PCR 下一轮上下文更省；
- PCR closed-loop 30/30；
- exact recovery/tool pair/restart 已由该 live run 验证；
- 已验证 200K threshold/overflow/recursive；
- 当前 HEAD required CI 全绿或 release-ready；
- T00–T54 committed 等于所有产品要求已满足。

## 重新 adopt 的最低条件

1. 当前 HEAD required CI 全绿且 main 受保护；
2. 默认 Extension 单一 RuntimeSession 纵向闭环；
3. Hard integrity 100%；
4. 真实 environment success non-inferior；
5. full capacity/cost/cache realized net 正，且 cluster CI 过门；
6. 100 clusters × 3 executor seeds 或预注册等价统计规模；
7. natural threshold、overflow、recursive 至少各一条完整 lane；
8. immutable full run bundle 可独立复核。
