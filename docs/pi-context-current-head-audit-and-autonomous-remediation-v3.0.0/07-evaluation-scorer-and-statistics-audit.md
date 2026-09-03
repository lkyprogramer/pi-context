# Evaluation、Scorer 与统计审计

## 已修正

- Probe answer 是唯一行为评分输入；
- Tool-call、Non-answer、Wrong-file、Unparseable 明确失败；
- Exact Recovery 读取 CAS 并核对 scope；
- Tool Pair 从 JSONL 计算；
- Arm 独立 workspace；
- Runner 支持增量保存和恢复。

## 主结构错误：B1 不能驱动产品采纳

建议正式定义：

| Arm | 目的 | 是否进入产品采纳主比较 |
|---|---|---|
| B0 | Pi Native | 是，基线 |
| B1 | PCR Checkpoint + Identity Materializer | 否，只做 compactor/component diagnostic |
| B2 | PCR Checkpoint + Full Recall Materializer | 是，产品候选 |
| F0 | 故障/消融 | 否，只做 failure containment |

### 两个独立 Gate

**Component Safety Gate：B1 vs B0**

- same cut；
- directive/claim/continuity integrity；
- exact recovery；
- no leak；
- no unpaired tools；
- checkpoint latency。

**Product Adoption Gate：B2 vs B0**

- task success 非劣；
- critical state 100%；
- recall precision/recall；
- cost/latency net value；
- cache rewrite；
- completion rate；
- long-horizon stability。

## 缺失样本规则

- planned denominator 永远不变；
- 仅 transport-class error 允许预注册的最多 2 次重试；
- exhausted timeout 在 ITT 中记失败；
- 同时报告 complete-case 和 worst-case sensitivity；
- 任一家族 timeout > 5% 或总体 completion < 99% 时，Publication Gate 关闭。
