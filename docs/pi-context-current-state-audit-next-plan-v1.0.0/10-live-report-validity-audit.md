# EFFECT / COMPARISON / report.json 有效性审计

## 报告可接受的事实

| 结论 | 可信度 | 限定语 |
|---|---|---|
| 30/30 完成、same-cut 30/30 | 高 | manual、synthetic-template、6.2K boundary |
| B0 真 Pi Native、B1 Hook checkpoint | 高 | 仅当前二臂 runner |
| PCR artifact 更短 | 中高 | 启发式 token estimate，不是 route tokenizer |
| PCR compact 更快 | 高 | 因为不做 summary LLM；不是同一算法加速 |
| B1 summary must-omit 0/30、B0 5/30 | 中高 | 只检查 visible summary literal |
| B1 literal directive 30/30 | 中 | 不等于 structured claim/执行正确 |
| keep-pi-native、publication=false | 高 | 保守结论正确 |

## 报告不成立的部分

| 原结论 | 判定 | 原因 |
|---|---|---|
| closed-loop 30/30 vs 30/30 | 无效 | 错误版本/伪 tool call 仍计成功 |
| next-round input +2.41% | 口径不清 | 只读 usage.input，忽略 cache fields |
| cost/success +1.28% | 不完整 | 不含价格/cache/summary/latency/failure，且过滤可破坏配对 |
| exact recovery | 未测 | 固定 false |
| tool pair 0 | 未测 | report 固定 0 |
| hard directive semantic coverage 100% | 过度 | English claim 解析为 use/version |
| plugin quality non-inferior | 未证明 | 无有效 reader/closed-loop/environment Gate |

## 是否支持“插件更优”

**不支持。** 最多支持“当前 deterministic checkpoint 在这 30 个模板上更短、更快、少复制 raw secret，并对 literal directive 有较好保留”。
