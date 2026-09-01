# 当前审计问题登记

> 状态均为 `open`。关闭必须由新 Task 的验收证据和当前 HEAD 的 Gate 共同完成，不能仅以代码文件或测试名称存在为依据。

## NF001 — Compatibility Required 仍为红

- 严重度：`P0`
- 领域：`CI`
- 观察：Node 24/min/Ubuntu 的 W1 Gate 在 unit suite 返回 keep-recovery-only；发布矩阵不成立。
- 修复任务：B01, B02, B31
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF002 — Task Evidence 只凭文件存在即可 Done

- 严重度：`P0`
- 领域：`Governance`
- 观察：taskctl 不验证日志结果、当前 HEAD、sourceDigest、run bundle、finding closure 或任务验收。
- 修复任务：B03, B04
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF003 — A43/A44/A45 等 Done 与真实结果矛盾

- 严重度：`P0`
- 领域：`Governance`
- 观察：自然阈值、Provider Overflow、三轮递归均失败，却仍标 Done 并声称 Finding closed。
- 修复任务：B04, B29, B30
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF004 — User/Tool Ingress 绕过 RuntimeSession

- 严重度：`P0`
- 领域：`Runtime`
- 观察：默认 Extension 创建 RuntimeSession 后仍返回 owner.service/observation，破坏唯一应用入口与串行化。
- 修复任务：B08, B15
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF005 — 全局 lastRecoveredCursor 与 close-all 生命周期

- 严重度：`P0`
- 领域：`Runtime`
- 观察：多 Session/Workspace 共用全局生命周期游标；任一 session_shutdown 关闭全部 owners。
- 修复任务：B09, B10, B15
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF006 — Context/Compaction 不共享权威事务 Snapshot

- 严重度：`P0`
- 领域：`Compaction`
- 观察：Materialize 用 readSnapshot，Compaction 的 transaction.run 只是 work()，并分散读取状态。
- 修复任务：B11
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF007 — Compaction Stage/Ack 不持久

- 严重度：`P0`
- 领域：`Compaction`
- 观察：单个 staged 变量仅存进程内；RuntimeSession acknowledge port 在产品实现为空。
- 修复任务：B12, B20
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF008 — 产品与 Live 未接入 Hard Gate Verifier

- 严重度：`P0`
- 领域：`Integrity`
- 观察：tool-pair/retained-tail/two-run 模块存在，但 Live toolPairViolation 固定 0。
- 修复任务：B13, B23
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF009 — Legacy Live Scorer 被 Summary 污染且容忍非回答

- 严重度：`P0`
- 领域：`Evaluation`
- 观察：质量允许 visible summary 替 Probe；closedLoop 只排少数显式错误。
- 修复任务：B21
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF010 — exactEvidenceRecovery 名称与实现不符

- 严重度：`P0`
- 领域：`Evaluation`
- 观察：recovered 实际为 fromExtension 且未泄露 must-omit，没有 CAS exact read/hash/bytes 检查。
- 修复任务：B22
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF011 — 100×3 的 Seed 只是标签

- 严重度：`P0`
- 领域：`Evaluation`
- 观察：seed 未注入模型、Provider、Trace 或 Sampling；不能解释为独立重复。
- 修复任务：B25
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF012 — 修复后 100×3 权威 Run 缺失且 Raw Report 被 Gitignore

- 严重度：`P0`
- 领域：`Evidence`
- 观察：现有 300 对是 backfill 前；backfill 后只跑小样本，原始 300 对不可随仓库复核。
- 修复任务：B07, B27, B28
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF013 — 真实 B2/F0/Tools-enabled Closed-loop 缺失

- 严重度：`P0`
- 领域：`Evaluation`
- 观察：V3 B0/B1/B2 是字符串 Stub；F0 是包含率；Executor 未由模型选择真实工具。
- 修复任务：B24, B26
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF014 — Natural Threshold、Provider Overflow、Recursive Lane 未过

- 严重度：`P0`
- 领域：`Live`
- 观察：0 threshold、overflowObserved=false、仅 compact-1。
- 修复任务：B29, B30
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF015 — Gate v3 可以在无 Live Provider 证据时形成 adopt 条件

- 严重度：`P0`
- 领域：`Release`
- 观察：evaluateW5Gate 仅基于 lane bundle/decision；publicationClaim 未强制 liveProvider=true 与权威 run identity。
- 修复任务：B31
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF016 — 产品 I_eff 没有完整 System/Tools/Provider/Cache 负载

- 严重度：`P0`
- 领域：`Economics`
- 观察：组件支持 reserves，但产品只计算 imageBlocks；真实 cacheRead/write 未接入。
- 修复任务：B16, B18
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF017 — Proactive Recall/Lease/Directory 未进入默认物化

- 严重度：`P1`
- 领域：`Materialization`
- 观察：组件和测试存在，Product RuntimeSnapshot 仅注入 directives/continuity/claims。
- 修复任务：B17
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF018 — Default-off 声明与默认注册 Background Hook 冲突

- 严重度：`P1`
- 领域：`Background`
- 观察：背景 Candidate 使用 128000、sys_runtime、tools_runtime 等 Fixture 常量。
- 修复任务：B14
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF019 — 生产路径仍保留 unbound/static cursor 和 Doctor Fixture

- 严重度：`P1`
- 领域：`Runtime`
- 观察：工具注册、后台和 Operations fallback 含 unbound；Doctor 使用 fixtureEnvironment。
- 修复任务：B14
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF020 — Unit/Integration/Live/Pack Lane 仍重叠和误名

- 严重度：`P1`
- 领域：`Testing`
- 观察：Unit 包含 integration/E2E/performance/release/gates；环境型 W1 测试导致 Matrix 漂移。
- 修复任务：B02
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF021 — Corpus v2 是模板化短 Case，不是 Publication-grade 独立轨迹

- 严重度：`P1`
- 领域：`Corpus`
- 观察：180 条来自 family/variant 生成；没有完整 Workspace、Pi JSONL、Store Snapshot 和真实 task clusters。
- 修复任务：B26
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF022 — B0/B1 Promise.all 并发造成 Provider 争用

- 严重度：`P1`
- 领域：`Performance`
- 观察：同一时间运行两臂，延迟差受排队/缓存/吞吐竞争影响。
- 修复任务：B25
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF023 — 没有真实 Prompt Cache 经济学

- 严重度：`P1`
- 领域：`Cache`
- 观察：报告只有下一轮 input 与估算 receipt，缺 cache hit/write/read、first-different 与价格映射。
- 修复任务：B18, B19
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF024 — Required Workflow 未要求最终 Live Publication Lane

- 严重度：`P1`
- 领域：`CI`
- 观察：Required 运行合成/组件 W1/W2 smoke，不执行 post-fix 100×3、真实阈值、overflow、recursive。
- 修复任务：B31
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF025 — Branch Protection 未被真实核验

- 严重度：`P1`
- 领域：`CI`
- 观察：verify-protection 只解析 YAML job 名；GitHub rulesets 为空，classic protection 未能读取。
- 修复任务：B05
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF026 — HANDOFF/COMPATIBILITY/OPERATIONS 与当前状态不一致

- 严重度：`P1`
- 领域：`Docs`
- 观察：Handoff 仍指旧快照；Compatibility 版本口径漂移；Operations 把 YAML 校验写成 apply protection。
- 修复任务：B06
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF027 — Deterministic Gate Artifact 绑定旧 Commit

- 严重度：`P1`
- 领域：`Release`
- 观察：gate-decision commit=8855d45，当前 HEAD=6c5c5b5，且 liveProvider=false。
- 修复任务：B28, B31
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF028 — Package 仍 private:true/UNLICENSED

- 严重度：`P1`
- 领域：`Packaging`
- 观察：当前只能视为内部 tarball，不能写成常规开源/npm release ready。
- 修复任务：B06, B31
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF029 — Live Report 混合修复前 300 对与修复后 30 对

- 严重度：`P1`
- 领域：`Reporting`
- 观察：报告 HEAD 为 a6281b3，附录补充 post-backfill 结果；缺单一最终 Run。
- 修复任务：B28
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。

## NF030 — Run Provenance 与任务证据不可独立验证

- 严重度：`P1`
- 领域：`Evidence`
- 观察：task evidence runBundleHashes 为空；Live 缺容器、完整请求、raw JSONL、Provider request IDs、当前 HEAD 绑定。
- 修复任务：B03, B07, B27
- 关闭条件：对应任务的 RED/GREEN/FULL-GATE 均通过，Evidence Seal 与当前 HEAD/Run Bundle Hash 一致。
