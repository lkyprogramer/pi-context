# Findings

| ID | Sev | Domain | Finding | Task |
|---|---|---|---|---|
| CF-001 | P0 | CI/Compile | 当前 HEAD 严格 TypeScript 编译失败 | C01 |
| CF-002 | P0 | Release/Pack | clean install 与 packed-install 失败 | C03 |
| CF-003 | P0 | Compatibility | 10/10 Compatibility 矩阵单元失败 | C04 |
| CF-004 | P0 | Governance | main 分支未启用保护 | C05 |
| CF-005 | P0 | Governance | verify-protection 在分支未保护时仍通过 | C05 |
| CF-006 | P1 | CI Semantics | 名为 build 的作业在严格编译失败时仍通过 | C02 |
| CF-007 | P1 | Documentation | HANDOFF 仍绑定旧审计 HEAD | C29 |
| CF-008 | P1 | Documentation | 已运行目录仍保留 UNRUN 标记 | C29 |
| CF-009 | P1 | Completion | 上一轮 B00-B31 不能整体标记完成 | C00 |
| CF-010 | P0 | Live Evaluation | 100×3 仅评分 280/300 | C24 |
| CF-011 | P1 | Statistics | 超时样本的缺失机制与敏感性分析不足 | C19 |
| CF-012 | P1 | Reproducibility | 断点续跑可能混合运行 epoch | C20 |
| CF-013 | P2 | Statistics | seed 名称高于真实控制能力 | C23 |
| CF-014 | P0 | Gate Design | 采纳效率门比较 B1 Identity 与 B0 Native | C16 |
| CF-015 | P1 | Arm Identity | B1/B2 compact text 相同但 view/probe 差异未分层解释 | C18 |
| CF-016 | P1 | Economics | compact 文本、下一请求输入与实际成本仍容易混淆 | C18 |
| CF-017 | P0 | Claim | 当前 Hard Gate 明确失败 | C31 |
| CF-018 | P1 | Artifacts | Raw bundle 中存在空文件、FAILED 和 partial 混合 | C20 |
| CF-019 | P0 | Artifacts | canonical hash 与 artifact byte hash 语义不清 | C21 |
| CF-020 | P2 | Repository Hygiene | 把成千上万 per-arm 文件提交到源码仓库 | C30 |
| CF-021 | P1 | Security | 公开提交 raw session JSONL 缺少独立脱敏门 | C30 |
| CF-022 | P1 | Natural Pressure | Natural lane 的总 triggered=false 掩盖 arm 差异 | C25 |
| CF-023 | P0 | Natural Pressure | PCR 通过 bounded materialization 避免 Host compact 被错误视为失败 | C25 |
| CF-024 | P1 | Economics | billedTokens=input+cacheRead 不是货币账单 | C13 |
| CF-025 | P1 | Host Contract | Provider reserve/cache 字段仍缺少权威 Host API | C12 |
| CF-026 | P1 | Recall | Lease Store 仍是进程内 Map | C11 |
| CF-027 | P1 | Recall | Lease TTL、剩余使用次数和回收未形成完整闭环 | C11 |
| CF-028 | P1 | Recall/Economics | 真实 Provider Cache/Metadata Ablation 未完成 | C15 |
| CF-029 | P0 | Overflow | Native 与 PCR 都未观察到真实 provider overflow | C26 |
| CF-030 | P1 | Overflow Design | Overflow prevention 与 overflow recovery 混在同一 lane | C26 |
| CF-031 | P1 | Long Horizon | threeCompacts=true 来自 grow 后手工 compact | C27 |
| CF-032 | P1 | Long Horizon | Recursive lane 未完整绑定 correction/branch/restart/side-effect oracle | C28 |
| CF-033 | P1 | Host Compatibility | 产品依赖 PCR patch 的 Pi 0.84.4 | C04 |
| CF-034 | P0 | Runtime Contract | session_shutdown 把 Event 强转 ExtensionContext | C06 |
| CF-035 | P0 | Runtime Contract | RuntimeToolCtx 被假设具有 cwd | C07 |
| CF-036 | P1 | Runtime Contract | 多处 callback 参数为 implicit any | C08 |
| CF-037 | P1 | Economics Contract | economics metadata 把 unknown 写入标量字段 | C01 |
| CF-038 | P1 | Test Architecture | Unit/Acceptance 全绿但生产严格编译失败 | C09 |
| CF-039 | P0 | Publication | Publication workflow 未被保护分支和双主门约束 | C31 |
| CF-040 | P2 | Product Status | Alpha 功能显著进步，但仍非 RC | C31 |
