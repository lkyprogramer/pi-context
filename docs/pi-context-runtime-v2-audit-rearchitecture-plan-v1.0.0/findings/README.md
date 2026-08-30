# 缺陷登记

本次静态审计登记 **38** 项：P0 为会使产品能力、评测结论或发布可信度失真的阻断项；P1 为 Alpha 前必须关闭的高优先问题。

| ID | 级别 | 区域 | 标题 |
|---|---|---|---|
| F001 | P0 | runtime | Composition Root 仍是 fixture/stub |
| F002 | P0 | ingress | 产品入口未注册 Tool Result Capture |
| F003 | P0 | ingress | 现有 Tool Result Adapter 即使注册也使用伪字段 |
| F004 | P0 | directives | Correction 规则只捕获标记词 |
| F005 | P0 | directives | Checkpoint 把所有 Directive 强制成 must-not |
| F006 | P0 | compaction | Checkpoint 不是从权威 Runtime Snapshot 构造 |
| F007 | P0 | retrieval | 已注册 Recall/Search 工具没有真实后端 |
| F008 | P0 | materialization | Hard directives 实际是常量 `keep` |
| F009 | P0 | materialization | Active-turn token 被按消息 ID 估算 |
| F010 | P0 | materialization | stitch 破坏四区布局 |
| F011 | P0 | identity | Host message ID 使用数组下标 |
| F012 | P0 | identity | 所有真实 Session 共用固定身份 |
| F013 | P0 | compaction | Candidate rejection 会取消 Pi Native |
| F014 | P0 | storage | SQLite 写入硬编码 s1/main/trusted-tool/inform |
| F015 | P0 | package | 发布包不是自包含实现 |
| F016 | P0 | package | 包声明 private/UNLICENSED 与安装文档冲突 |
| F017 | P0 | ci | 当前远端 CI 未运行任何测试 |
| F018 | P0 | test-oracle | Temporal Oracle 含源轨迹不存在的值 |
| F019 | P0 | test-scoring | 闭环用 summary+probe 并集评分 |
| F020 | P0 | test-scoring | Exact recovery 被替换成“不泄密” |
| F021 | P0 | test-scoring | Tool pair 与 determinism 是硬编码 |
| F022 | P0 | test-design | 100 对只是 5 个模板的参数化副本 |
| F023 | P0 | test-design | Live Gate 不代表真实长会话压力 |
| F024 | P0 | test-design | Continuation 没有环境与工具 |
| F025 | P0 | test-design | Compactor 比较混入 Ingress 安全差异 |
| F026 | P0 | economics | realizedNet 只是 probe token 差 |
| F027 | P1 | test-design | cost/success 被启发式闭环污染 |
| F028 | P1 | process | W1 Gate 语料在失败后增加 filler 以过门 |
| F029 | P1 | evidence | Live 原始 report.json 被 gitignore |
| F030 | P1 | provenance | 运行时 harness 在实验时未提交 |
| F031 | P1 | tests | 所谓 packed-install test 生成了另一个假 extension |
| F032 | P1 | tests | E2E 使用 fakeHost 只验证注册数量 |
| F033 | P1 | offsets | byteRange 实际是 UTF-16 code-unit range |
| F034 | P1 | source-trust | 所有 toolResult 默认 trusted-tool |
| F035 | P1 | usage | Adapter 为 assistant 补零 usage |
| F036 | P1 | cache | CachePlan 没有上一请求基线 |
| F037 | P1 | background | 后台 Worker 使用内存假 Store |
| F038 | P1 | tests | Live Gate 不在默认 `pnpm test` |

完整证据和修复建议见 `findings.json`。任何 AI Agent 不得直接修改 finding 状态；只有对应 Task 的验收证据通过后，`scripts/findingctl.py close <ID> --evidence <path>` 才能关闭。
