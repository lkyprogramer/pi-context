# 最近提交与实际效果

相对上一版审计，当前 HEAD 增加 10 个提交。改造不是文档美化，而是跨 Runtime、Store、Benchmark、CI 和 Live Lane 的实质实现。

## 总体评价

| Wave | 实际收益 | 残余问题 |
|---|---|---|
| W0 | Required workflow、Hermetic fixture、跨进程测试明显改善 | Compatibility 仍红；Protection 未真实配置；Lane 仍重叠 |
| W1 | RuntimeSession、State Store、Snapshot、Recovery 组件增多 | Ingress 绕过 Session；Global lifecycle；Ack 不持久 |
| W2 | Temporal、Retention、Catalog、Claim、Recall、Isolation 增强 | Recall 未进入 Product Materializer；global state 风险仍在 |
| W3 | Envelope pricing、Usage、Hard Gate、short-ref 实现 | 产品 payload/cache usage 未接；Hard Gate 未进入 Legacy Live |
| W4 | Corpus、Scorer、Statistics、Bundle、Gate v3 组件形成 | 真实 Arm/Reader/Closed-loop 不成立 |
| W5 | 真实 Endpoint Lane 尝试和报告披露 | 三条长程 Lane 未过；修复后权威 100×3 缺失 |

机器明细见 `evidence/current-commit-delta.csv`。

## 一个重要模式

多个提交标题使用“make ... real”“all hooks through RuntimeSession”“run ... lane”，但实际实现常常只满足组件接口或尝试运行，而不满足任务文档的验收语义。后续必须把 commit subject、task status、test lane 和 acceptance result 用同一 Evidence Schema 绑定。
