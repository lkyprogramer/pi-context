# Pi Context Runtime Master Implementation Plan

> **For agentic workers:** 必须遵守 [`../tasks/EXECUTION-PROTOCOL.md`](../tasks/EXECUTION-PROTOCOL.md)，以 Task 文件作为唯一执行单元。无需任何包外 Skill。

**Goal:** 构建不修改 Pi 源码、以公开 Extension API 集成、具有外部可审计状态与周期性 Pi Host Compaction 的 Pi Context Runtime。  
**Architecture:** Host-agnostic Kernel 管 Evidence/Directive/Claim/Continuity/Retrieval/Materialization；Pi Adapter 是薄转换层；SQLite/CAS 与 Pi JSONL 通过可恢复 Saga 协作。  
**Tech Stack:** Node `^22.23.2 || ^24.18.1 || >=26.5.1`、TypeScript 5.9、pnpm workspace、Vitest 4、`node:sqlite`、FTS5、Pi Coding Agent 0.84.3 Public API。  
**Spec:** [`../04-target-architecture.md`](../04-target-architecture.md)

## Global Constraints

- 不修改或 Fork Pi；不导入 `earendil-works/pi` 的 `src/` 私有路径。
- 最终 npm/Pi 包只注册一个 Extension entry。
- `kernel` 不依赖任何 Pi 类型。
- 原始 Tool Result 先写加密 CAS，再运行 reducer；异常行为按 profile 显式处理。
- Pi JSONL 与 Runtime Store 不宣称跨存储 ACID；使用 Saga/recovery。
- Request-local materialization 与 periodic Pi-native custom compaction 必须同时存在。
- Authenticated User Directive 原文、极性、数字、路径、时间、scope 不可静默丢失。
- Semantic 只能提交 proposal；Authority/Outcome/Action 由确定性代码裁决。
- W1 Early Net Value Gate 失败时停止扩大语义层，保留 reducers/exact recall 产品。

## Frozen File Structure

```text
apps/pi-context-runtime/
packages/contracts/
packages/kernel/
packages/storage/
packages/worker/
packages/pi-adapter/
packages/testkit/
tests/
benchmarks/
scripts/
compat/pi.lock.json
```

## Task Table

| ID | Wave | Deliverable | Depends On | Public Symbol |
|---|---|---|---|---|
| T01 | W0 | 创建 Monorepo、包边界与基础 CI | — | `assertWorkspaceLayout` |
| T02 | W0 | 实现唯一 Canonical Type、ID 与错误词汇 | T01 | `SourceClass` |
| T03 | W0 | 实现确定性编码、域隔离哈希、时钟与 ID Provider | T02 | `domainHash` |
| T04 | W0 | 实现单一 Pi Extension Orchestrator 与进程级 Owner Claim | T01, T02 | `claimPiContextOwner` |
| T05 | W0 | 实现 Pi Public API Capability Probe 与契约测试宿主 | T01, T04 | `probePiCapabilities` |
| T06 | W0 | 实现单写 Worker、SQLite Schema 与事务 RPC | T02, T03 | `SqliteStore` |
| T07 | W0 | 实现加密 Content-addressed Blob Store 与 Key Provider | T02, T03 | `EncryptedBlobStore` |
| T08 | W0 | 实现跨 Pi JSONL 与 Runtime Store 的可恢复 Saga | T05, T06, T07 | `SagaCoordinator` |
| T09 | W1 | 捕获原始 Input Receipt 并关联 Pi 展开后的 User Message | T02, T05, T06, T08 | `InputCorrelator` |
| T10 | W1 | 实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量 | T09 | `captureUserDirectives` |
| T11 | W1 | 在 Pi `tool_result` 写入前完成原文捕获、CAS 与 Prepared Receipt | T05, T07, T08 | `captureObservation` |
| T12 | W1 | 实现确定性 Reducer Registry、Revision 路由与资源限制 | T02, T11 | `ReducerRegistry` |
| T13 | W1 | 实现 Bash/构建/测试日志 Reducers | T12 | `reduceTestLog` |
| T14 | W1 | 实现 read/grep/find/ls/edit/write 的结构化 Reducers | T12 | `reduceSearchResult` |
| T15 | W1 | 实现 EvidenceUnit Admission、Provenance 与 Observation Projection | T10, T11, T12, T13, T14, T06 | `admitEvidence` |
| T16 | W1 | 实现 Evidence/Blob/Range 的精确读取与 Scope Enforcement | T15, T07 | `readEvidenceById` |
| T17 | W1 | 实现 Literal/Path/Error/Command 倒排索引与时间过滤 | T15, T06 | `LiteralIndex` |
| T18 | W1 | 实现 Workspace-scoped FTS5 Catalog、Rebuild 与 Fallback | T17, T06 | `FtsCatalog` |
| T19 | W1 | 实现每个顶层 User Turn 的主动 Recall Query 与有界 Page | T10, T16, T18 | `buildProactiveRecallPage` |
| T20 | W2 | 实现 Bitemporal Claim Ledger 与 Support Closure | T15, T06 | `ClaimLedger` |
| T21 | W2 | 实现 Claim 冲突、Supersession、Retraction 与 Audit Slice | T20 | `applyClaimTransition` |
| T22 | W2 | 实现 Outcome Attestation 与 Side-effecting Tool Action Gate | T15, T20, T21, T05 | `authorizeToolCall` |
| T23 | W2 | 实现 Task Fronts、External Side Effects 与 Next Safe Action Ledger | T10, T20, T21 | `reduceContinuityRevision` |
| T24 | W2 | 实现有效输入预算、Provider Usage 校准与预测增长 | T03, T05 | `computeEffectiveInputBudget` |
| T25 | W2 | 实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity | T02, T15, T23, T24 | `buildExactActiveSuffix` |
| T26 | W2 | 实现四区 Cache-aware Request Materializer 与 Reduction Ladder | T19, T23, T24, T25 | `ContextMaterializer` |
| T27 | W2 | 接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort | T04, T05, T26 | `registerContextHook` |
| T28 | W2 | 实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap | T19, T23, T26 | `LeasePolicy` |
| T29 | W2 | 实现 Pi Host Checkpoint Schema 与 Cache-stable Renderer | T10, T20, T23, T24 | `renderHostCheckpoint` |
| T30 | W2 | 构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate | T29, T15, T16 | `buildDeterministicCheckpointCandidate` |
| T31 | W2 | 接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment | T04, T05, T30 | `registerCompactionHooks` |
| T32 | W2 | 实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure | T24, T27, T31 | `decideHostConvergence` |
| T33 | W2 | 实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery | T08, T27, T31, T32 | `registerSessionLifecycle` |
| T34 | W3 | 实现 `agent_settled` 后的可取消 Background Candidate Worker | T08, T23, T30, T33 | `CandidateWorker` |
| T35 | W3 | 实现 Semantic Proposal Schema 与受限生成 Adapter | T20, T23, T34 | `generateSemanticProposal` |
| T36 | W3 | 实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor | T15, T20, T21, T23, T35 | `verifySemanticProposal` |
| T37 | W3 | 实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard | T34, T36, T08 | `publishVerifiedGeneration` |
| T38 | W3 | 实现脱敏 Telemetry、Cache/Economics 与 Realized Net Value Controller | T24, T26, T31, T37 | `calculateRealizedNetValue` |
| T39 | W4 | 实现 Recall/Search/Status/Pin 工具与运维命令 | T16, T18, T19, T22, T28 | `registerRuntimeTools` |
| T40 | W4 | 实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理 | T04, T05, T27, T31, T39 | `runRuntimeDoctor` |
| T41 | W4 | 运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO | T06, T07, T18, T26, T31 | `runPerformanceSpikes` |
| T42 | W4 | 实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution | T27, T31, T38, T41 | `runBenchmarkSuite` |
| T43 | W4 | 实现 Memory Poisoning、Secret、Authority、Cursor 与 Recovery Fuzz/Mutation Suite | T07, T10, T15, T22, T31, T36 | `runSecuritySuite` |
| T44 | W4 | 实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics | T05, T27, T31, T40 | `verifyPiCompatibility` |
| T45 | W5 | 执行 Deterministic MVP Release Gate 与 Stop/Continue 决策 | T33, T39, T40, T41, T42, T43, T44 | `evaluateDeterministicMvpGate` |
| T46 | W5 | 执行 Semantic/Background Beta Gate 与 Ablation 决策 | T34, T35, T36, T37, T38, T45 | `evaluateSemanticBetaGate` |
| T47 | W5 | 实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具 | T06, T07, T08, T40, T45 | `createWorkspaceBackup` |
| T48 | W5 | 完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证 | T44, T45, T46, T47 | `buildReleaseArtifact` |

## Execution

1. `python3 scripts/taskctl.py next` 选择拓扑就绪任务。
2. Agent 读取对应 Task、依赖 Evidence 和引用 specs。
3. 完成 RED→GREEN→negative/fault→full gate→Evidence→Commit。
4. Reviewer 运行 `python3 scripts/taskctl.py verify-evidence Txx`。
5. 只有 Review 通过才由 `taskctl` 把本地 `.pcr/task-status.jsonl` 置为 done 并解锁消费者。

## Wave Gates

- **W0:** Pi Hook 契约、单 Owner、Store/CAS/Saga 可运行。
- **W1:** reducers + exact/FTS/proactive recall 对 Pi Native smoke 产生正净值，否则停止。
- **W2:** Directive/Claim/Continuity/Materializer/Pi Compaction 长会话有界。
- **W3:** Semantic 只在 verifier 与 economics 正门后启用。
- **W4:** packed install、兼容、性能、安全、benchmark 全部有证据。
- **W5:** deterministic MVP 与 semantic beta 独立决策，可回滚发布。

## Completion

`T48` 只能在 T44–T47 Evidence 全部通过后执行。完成状态必须由 release artifact test、SBOM、Manifest、clean Pi-home install 和 rollback rehearsal 证明。
