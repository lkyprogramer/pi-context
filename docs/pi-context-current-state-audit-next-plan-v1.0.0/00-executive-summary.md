# 执行摘要

## 最终判断

### 1. 当前开发不是“没做完”

最近提交已经落地真实 cursor、SQLite/CAS/Saga、Tool Result reducer、Evidence/FTS、完整 correction clause、Continuity、Materializer、Checkpoint v2、Native fallback、B0/B1/B2 抽象、Oracle、Cluster statistics、Pack harness 等模块。与旧版 fixture runtime 相比，这是实质性进步。

### 2. 但“产品纵向闭环完成”仍不成立

默认公开 Extension 仍自行拼装多个子系统，而不是把全部 Hook 交给唯一 `RuntimeSession`；Context 使用消息临时构造 directives、continuity 为空；Compaction 使用 preparation 临时构造 claim、pointer verifier no-op；Recovery/Background 仍有 stub/hardcode。模块完成度高于产品闭环完成度。

### 3. 当前报告不支持“插件更优”

可支持的窄结论：

- PCR checkpoint artifact 约短 71%；
- 手工 compaction 前台延迟约低 80%，因为没有摘要 LLM；
- 当前 30 条合成数据中 PCR summary 没复制 must-omit 字符串，Native 复制 5 条；
- literal hard directive 在 B1 checkpoint 中覆盖 30/30。

不能支持的结论：

- 压缩后下一轮输入更省；
- 真实任务成功率不劣或更高；
- exact recovery/tool pair/restart 已通过；
- Natural threshold/overflow/递归长程已验证；
- 插件可以替换 Pi Native 默认 compactor。

### 4. 当前 `keep-pi-native` 决策正确

即使不考虑评分缺陷，报告自身给出：

- next-round `usage.input` Δ `+2.41%`；
- realized net `-11.5`；
- recovery `0`；
- sample `30×1`，不是 `100×3`；
- publicationClaim=false。

考虑评分缺陷后，证据只会更弱，不会反转为 adopt。

## 当前阶段建议

- **产品默认**：继续 Pi Native compaction。
- **可保留能力**：PCR ingress/CAS/reducer、secret scrub、exact read/search、deterministic checkpoint 作为实验候选。
- **立即优先级**：先修 CI 与评分器，再统一产品 RuntimeSession，最后运行真实 B0/B1/B2/F0 及 tools-enabled closed-loop。
- **Semantic/Background**：保持 default-off，直到 deterministic 产品 Gate 和 B2 closed-loop 都通过。
