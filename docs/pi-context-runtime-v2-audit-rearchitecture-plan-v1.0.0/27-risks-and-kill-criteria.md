# 风险与 Kill Criteria

| 风险 | 控制 |
|---|---|
| Pi extension API 变化 | minor pin + contract matrix + capability probe |
| context hook 仍需 clone 全历史 | periodic Pi Native/PCR host compaction + clone benchmark |
| Directive parser 漏检 | full user-turn catalog + proactive recall + exact clause fallback |
| Runtime 复杂度再次横向膨胀 | vertical Wave gates；未接入的模块不得算完成 |
| Cache savings 被 layout 破坏 | section receipt + provider usage gate |
| Recall 污染 | needed/not-needed split + lease + silence gate |
| Semantic hallucination | source refs + deterministic verifier + optional layer |

## Kill Criteria

- W1 locked real traces无正 token/cost收益：停止 semantic/claim 扩展，保留 CAS/recovery；
- B1/B2 对 Pi Native+same-ingress 质量非劣失败：保留 Native compaction；
- proactive recall task delta≤0 或 silence<0.9：默认关闭 proactive；
- packed vertical acceptance 不稳定：停止发布；
- cache-adjusted cost/success变差：回退简单 stable checkpoint。
