# Rollout 与 Kill Criteria

## Stage 0

修 CI 与 scorer；不改变用户默认 compactor。

## Stage 1

启用 PCR ingress/CAS/reducer，compactor仍 Native。若 W1 没有正净值，保留 exact recovery、停止其他层。

## Stage 2

PCR checkpoint shadow：生成但不提交，对 Native summary 做 artifact/reader 比较。

## Stage 3

小流量 B1：仅满足白名单 session/profile，任何 hard/quality failure 即 Native fallback。

## Stage 4

B2 materializer/recall；仅在 B1 已非劣且 recall 净值为正后。

## Kill

- hard integrity 任一失败；
- quality CI lower < -0.02；
- recursive lane directive/side-effect 丢失；
- current required CI 非绿；
- realized net 连续两个版本 ≤0；
- cache rewrite cost 吞掉节省；
- background stale/waste 高于预注册上限。
