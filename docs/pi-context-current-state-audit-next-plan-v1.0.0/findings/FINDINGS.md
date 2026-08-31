# 当前问题登记

本表重新打开了此前被 taskctl/findingctl 标记关闭、但当前 HEAD/CI/Live 证据未满足最终验收的事项。

| ID | 级别 | 领域 | 问题 | 状态 | 证据 | 任务 |
| --- | --- | --- | --- | --- | --- | --- |
| F101 | P0 | ci | 当前 HEAD 远端 CI 为红 | open | S25, S40, S39 | A00, A01, A02, A03, A04, A05 |
| F102 | P0 | test-infra | 测试硬编码开发机 macOS 临时目录 | open | S26, S40 | A01, A04 |
| F103 | P0 | test-infra | Clean-install 测试依赖开发者 ~/.pi/agent/models.json | open | S27, S40 | A02, A04, A49 |
| F104 | P0 | test-infra | 跨进程存储测试依赖缺失的 jiti 与脆弱信号断言 | open | S40 | A03, A46 |
| F105 | P0 | runtime | 默认公开 Extension 未以 RuntimeSession 为唯一应用入口 | open | S02, S03, S31 | A08, A09 |
| F106 | P0 | materialization | Context Snapshot 不是 Store-backed active state | open | S02, S32, S33 | A11, A12, A26 |
| F107 | P0 | budget | Token 计价忽略 Pi Envelope 的 summary/tool-call 等原始字段 | open | S04, S05, S33 | A24, A25 |
| F108 | P0 | cache | Cache Receipt 为单次 open 的内存数组 | open | S02, S33 | A13, A25, A27 |
| F109 | P0 | compaction | 产品 Checkpoint 仍由 transient preparation 拼装 | open | S02, S07, S32, S34 | A11, A12, A28 |
| F110 | P0 | compaction | Pointer 与 Checkpoint Verifier 在产品路径形同虚设 | open | S02, S09, S34 | A29, A30 |
| F111 | P0 | scope | lastPointers 是全局最近值而非 cursor/snapshot 范围 | open | S03 | A10, A19, A23 |
| F112 | P0 | recovery | Lifecycle/Recovery 仍含 no-op journal 和 unbound 降级 | open | S02, S32, S39 | A15, A16, A23 |
| F113 | P1 | background | Background Candidate 仍混合硬编码 snapshot 与内存状态 | open | S02, S39 | A47, A50 |
| F114 | P0 | evaluation | Live closed-loop scorer 会把错误答案判成功 | open | S11, S16 | A35, A37 |
| F115 | P0 | evaluation | Exact recovery 永远 false，tool-pair 却固定为 0 | open | S11, S22, S36 | A38 |
| F116 | P0 | evaluation | 所谓 probe input 只读取 usage.input，忽略 cacheRead/cacheWrite | open | S11, S36 | A25, A39 |
| F117 | P0 | evaluation | W2 Live 不符合文档要求的 A1-shaped B0/B1/B2 | open | S11, S13, S35 | A33, A34, A36 |
| F118 | P0 | evaluation | 新增 tests/live/w2-paired.test.ts 并非 live Pi 对照 | open | S17, S18 | A34 |
| F119 | P1 | evaluation | Full-context ceiling 只是 expected 字符串包含率 | open | S19, S35 | A36 |
| F120 | P0 | evaluation | Closed-loop 测试使用预编程正确 Executor | open | S20, S21 | A37 |
| F121 | P0 | directives | 英文 temporal correction 被错误解析 | open | S10, S16 | A17 |
| F122 | P1 | compaction | 递归 compaction 可能丢失旧 Checkpoint 中的 active directives | open | S02, S34, S37 | A18, A22, A45 |
| F123 | P0 | governance | Branch 未保护且 required checks 未启用 | open | S25, S38, S39 | A05 |
| F124 | P1 | statistics | 30×1 实际只有 5 个模板 cluster | open | S11, S12, S36 | A32, A40, A42 |
| F125 | P1 | evaluation | Live run 是 manual 6.2K + keepRecent=2K | open | S13, S14, S37 | A43, A44 |
| F126 | P1 | evaluation | 缺少递归长程、branch、recall-needed 和 side-effect continuation | open | S15, S37 | A45, A46 |
| F127 | P1 | economics | realized_net 只是 prompt input 差 | open | S11, S36 | A39 |
| F128 | P1 | economics | cost/success 先按各臂成功独立过滤，破坏配对 | open | S11 | A39, A40 |
| F129 | P1 | reproducibility | Runner 删除临时 Session，只保留 400 字符 preview | open | S11, S16, S37 | A41 |
| F130 | P1 | provenance | 报告路径含开发机绝对路径，运行快照与当前 HEAD 不同 | open | S14, S15, S16 | A00, A41 |
| F131 | P1 | package | 包元数据仍 private:true / UNLICENSED | open | S28, S38 | A06 |
| F132 | P1 | package | 仓库 committed dist 仍重导出 TS 源码 | open | S27, S29 | A06, A49 |
| F133 | P1 | storage | 数据根按 session directory，而目标称 per-workspace/shared store | open | S03, S31 | A09, A23 |
| F134 | P1 | governance | F001–F038 全部 closed 与当前证据冲突 | open | S01, S02, S31, S39 | A07 |
| F135 | P1 | gate | 新 Gate Engine 的 W2 adopt 条件过弱 | open | S24, S36 | A40, A48 |
| F136 | P1 | gate | Gate RunBundle 无法表达目标统计合同 | open | S24, S36 | A40 |
| F137 | P1 | security | must-omit 只检查 visible summary | open | S11, S36 | A38, A46 |
| F138 | P2 | checkpoint | 模型可见 checkpoint 审计元数据过重 | open | S08, S14, S16 | A31, A47 |
| F139 | P1 | budget | 系统提示、tools schema、image 等未进入真实 I_eff 校准 | open | S02, S04, S33 | A14, A24, A25 |
| F140 | P1 | scope | Tools/operations 通过 last owner/last cursor heuristic 解析 | open | S02, S03 | A10, A23 |
| F141 | P2 | architecture | v2 与 legacy kernel/storage/worker 并存 | open | S01 | A09, A07 |
| F142 | P2 | measurement | summaryTokens 使用启发式估算，不是 route tokenizer | open | S11, S14 | A25, A39 |

## 严重度定义

- **P0**：会导致产品状态错误、Gate 失真、隔离/恢复不成立、当前发布阻断。
- **P1**：不立即破坏单次 happy path，但阻断“优于 Native”或生产成熟度结论。
- **P2**：维护性、成本或后续扩展风险。
