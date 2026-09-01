# 执行摘要

## 总判

**当前项目已经从“模块拼装原型”推进到“具备真实存储与宿主接线的 Alpha”，但仍不是满足原文档定义的 deterministic MVP，更不能证明 PCR 整体优于 Pi Native。**

| 维度 | 评分 | 判断 |
|---|---:|---|
| 模块实现完整度 | 8/10 | Cursor、SQLite、CAS、FTS、Directive/Claim/Continuity、Pointer Verifier、Pack 均有实质实现 |
| 默认产品纵向闭环 | 6/10 | Context/Compaction 已接 RuntimeSession，但 Ingress、Lifecycle、Ack、Recall、Budget 仍未统一 |
| 测试工程 | 6/10 | Required 主线全绿，测试量大；Lane 语义重叠且 Compatibility 当前红 |
| Benchmark 可信度 | 4/10 | 真 B0/B1 有价值；Scorer、Recovery、Seed、B2/F0/Closed-loop 仍有根本缺口 |
| 报告质量 | 7/10 | 对失败披露诚实；但前后 Run 混合、Raw Evidence 缺失、HEAD 不统一 |
| 发布就绪度 | 3/10 | Compatibility 红、Protection 未证、Gate 绑定旧 commit/liveProvider=false |

## 可以确认的进步

- 真实 Workspace/Session/Leaf/Lineage/Model Cursor 已落地；
- Tool Result 能进入加密 CAS、Reducer、Evidence 与 FTS；
- User full-turn、Directive、Claim、Continuity、Cache Receipt 已持久化；
- 中英文 correction/supersession 明显改善；
- Context Materializer 开始读取 Store Snapshot；
- Checkpoint 可带 Pointer 并做 CAS scope 验证；
- Native fallback、Hermetic Pack、Required Workflow 均比上一版可靠；
- 当前报告保持 `keep-pi-native` 与 `publicationClaim=false`，没有用漂亮数字掩盖 Hard Gate 失败。

## 六个最关键的阻断

1. **唯一 RuntimeSession 不成立**：`composition-root.ts:887-905` 先创建 Session，再把 User/Tool Hook 直接绑定到 `owner.service/observation`，绕过 RuntimeSession 的写串行化。
2. **Compaction 不具备单事务与持久 Ack**：`composition-root.ts:717-745` 的 transaction 只是 `work()`；`extension.ts:151-205` 的 staged candidate 仅在内存；产品 `acknowledge()` 为空。
3. **测试证据治理失真**：旧 `taskctl.py:25-29` 只检查 evidence 文件存在；A43/A44/A45 即使 Live 失败仍被标 Done。
4. **Compatibility 当前红**：Node 24/min/Ubuntu 的 W1 Gate 在 unit lane 因环境差异返回 `keep-recovery-only`。
5. **Legacy Live Scorer 不可信**：Summary 可替 Probe 得分；`exactRecovery` 不是 CAS Read；`toolPairViolation` 固定为 0；Seed 只是标签。
6. **发布级 Live 证据缺失**：修复后完整 100×3 未跑，B2/F0/Tools-enabled Closed-loop 未实现，Natural Threshold/Provider Overflow/Recursive Lane 均未过。

## 对上一版 51 个任务的复核

声明 `done` 的 A00–A49 中，本次复核结果为：

- verified / verified-component：15
- partial / verified-component-not-integrated：25
- not-met：10
- pending：1

完整结果见 `compliance/previous-task-status.csv`。

## 当前允许的产品声明

允许：

- “PCR 的 Ingress/CAS/Reducer/Exact Read 模块已具备真实产品路径。”
- “在修复前 300 对实验中，PCR Artifact 与下一轮输入明显更短，前台 compact 更快；该 Run 的 Hard Gate 失败。”
- “Natural/Overflow/Recursive Live 尝试均未达到验收。”
- “默认继续使用 Pi Native。”

禁止：

- “A00–A49 已全部验收完成。”
- “PCR 已整体优于 Pi Native。”
- “100×3 证明修复后 PCR 通过 Hard/Quality/Efficiency。”
- “已完成 200K 自动阈值、真实 Provider Overflow、三次递归压缩。”
- “当前仓库 release-ready。”

## 下一轮顺序

```text
W0 Evidence/CI Truth
→ W1 Runtime Ownership & Durability
→ W2 Materialization/Cache Economics
→ W3 Real Evaluation
→ W4 Live & Release
→ Semantic Beta 继续 blocked
```
