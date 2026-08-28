# AI Agent 可执行任务目录

本目录包含 48 个独立 Reviewer Gate。每个任务都有精确文件边界、接口、RED/GREEN、负例、命令、Evidence 和 Commit 规则。

执行入口：[`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。任务依赖以 [`task-graph.json`](task-graph.json) 为机器权威；本文表格仅便于浏览。

| ID | Wave | Task | Depends On | Primary Symbol |
|---|---|---|---|---|
| T01 | W0 | [创建 Monorepo、包边界与基础 CI](T01-workspace-scaffold.md) | — | `assertWorkspaceLayout` |
| T02 | W0 | [实现唯一 Canonical Type、ID 与错误词汇](T02-canonical-contracts.md) | T01 | `SourceClass` |
| T03 | W0 | [实现确定性编码、域隔离哈希、时钟与 ID Provider](T03-canonical-encoding-hashes.md) | T02 | `domainHash` |
| T04 | W0 | [实现单一 Pi Extension Orchestrator 与进程级 Owner Claim](T04-single-extension-orchestrator.md) | T01, T02 | `claimPiContextOwner` |
| T05 | W0 | [实现 Pi Public API Capability Probe 与契约测试宿主](T05-pi-contract-harness.md) | T01, T04 | `probePiCapabilities` |
| T06 | W0 | [实现单写 Worker、SQLite Schema 与事务 RPC](T06-sqlite-store.md) | T02, T03 | `SqliteStore` |
| T07 | W0 | [实现加密 Content-addressed Blob Store 与 Key Provider](T07-encrypted-blob-cas.md) | T02, T03 | `EncryptedBlobStore` |
| T08 | W0 | [实现跨 Pi JSONL 与 Runtime Store 的可恢复 Saga](T08-saga-recovery.md) | T05, T06, T07 | `SagaCoordinator` |
| T09 | W1 | [捕获原始 Input Receipt 并关联 Pi 展开后的 User Message](T09-raw-input-receipt.md) | T02, T05, T06, T08 | `InputCorrelator` |
| T10 | W1 | [实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量](T10-user-directive-capture.md) | T09 | `captureUserDirectives` |
| T11 | W1 | [在 Pi `tool_result` 写入前完成原文捕获、CAS 与 Prepared Receipt](T11-tool-result-raw-capture.md) | T05, T07, T08 | `captureObservation` |
| T12 | W1 | [实现确定性 Reducer Registry、Revision 路由与资源限制](T12-reducer-registry.md) | T02, T11 | `ReducerRegistry` |
| T13 | W1 | [实现 Bash/构建/测试日志 Reducers](T13-shell-build-test-reducers.md) | T12 | `reduceTestLog` |
| T14 | W1 | [实现 read/grep/find/ls/edit/write 的结构化 Reducers](T14-builtin-tool-reducers.md) | T12 | `reduceSearchResult` |
| T15 | W1 | [实现 EvidenceUnit Admission、Provenance 与 Observation Projection](T15-evidence-units.md) | T10, T11, T12, T13, T14, T06 | `admitEvidence` |
| T16 | W1 | [实现 Evidence/Blob/Range 的精确读取与 Scope Enforcement](T16-exact-evidence-read.md) | T15, T07 | `readEvidenceById` |
| T17 | W1 | [实现 Literal/Path/Error/Command 倒排索引与时间过滤](T17-literal-search-index.md) | T15, T06 | `LiteralIndex` |
| T18 | W1 | [实现 Workspace-scoped FTS5 Catalog、Rebuild 与 Fallback](T18-fts-catalog.md) | T17, T06 | `FtsCatalog` |
| T19 | W1 | [实现每个顶层 User Turn 的主动 Recall Query 与有界 Page](T19-proactive-recall.md) | T10, T16, T18 | `buildProactiveRecallPage` |
| T20 | W2 | [实现 Bitemporal Claim Ledger 与 Support Closure](T20-claim-ledger.md) | T15, T06 | `ClaimLedger` |
| T21 | W2 | [实现 Claim 冲突、Supersession、Retraction 与 Audit Slice](T21-claim-conflict-supersession.md) | T20 | `applyClaimTransition` |
| T22 | W2 | [实现 Outcome Attestation 与 Side-effecting Tool Action Gate](T22-outcome-attestation-action-gate.md) | T15, T20, T21, T05 | `authorizeToolCall` |
| T23 | W2 | [实现 Task Fronts、External Side Effects 与 Next Safe Action Ledger](T23-continuity-ledger.md) | T10, T20, T21 | `reduceContinuityRevision` |
| T24 | W2 | [实现有效输入预算、Provider Usage 校准与预测增长](T24-token-accounting.md) | T03, T05 | `computeEffectiveInputBudget` |
| T25 | W2 | [实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity](T25-active-turn-suffix.md) | T02, T15, T23, T24 | `buildExactActiveSuffix` |
| T26 | W2 | [实现四区 Cache-aware Request Materializer 与 Reduction Ladder](T26-materializer.md) | T19, T23, T24, T25 | `ContextMaterializer` |
| T27 | W2 | [接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort](T27-context-hook-integration.md) | T04, T05, T26 | `registerContextHook` |
| T28 | W2 | [实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap](T28-retrieval-leases.md) | T19, T23, T26 | `LeasePolicy` |
| T29 | W2 | [实现 Pi Host Checkpoint Schema 与 Cache-stable Renderer](T29-host-checkpoint-renderer.md) | T10, T20, T23, T24 | `renderHostCheckpoint` |
| T30 | W2 | [构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate](T30-deterministic-host-checkpoint.md) | T29, T15, T16 | `buildDeterministicCheckpointCandidate` |
| T31 | W2 | [接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment](T31-compaction-takeover.md) | T04, T05, T30 | `registerCompactionHooks` |
| T32 | W2 | [实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure](T32-host-convergence-controller.md) | T24, T27, T31 | `decideHostConvergence` |
| T33 | W2 | [实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery](T33-session-lifecycle.md) | T08, T27, T31, T32 | `registerSessionLifecycle` |
| T34 | W3 | [实现 `agent_settled` 后的可取消 Background Candidate Worker](T34-background-candidates.md) | T08, T23, T30, T33 | `CandidateWorker` |
| T35 | W3 | [实现 Semantic Proposal Schema 与受限生成 Adapter](T35-semantic-proposal.md) | T20, T23, T34 | `generateSemanticProposal` |
| T36 | W3 | [实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor](T36-verifier.md) | T15, T20, T21, T23, T35 | `verifySemanticProposal` |
| T37 | W3 | [实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard](T37-generation-fencing.md) | T34, T36, T08 | `publishVerifiedGeneration` |
| T38 | W3 | [实现脱敏 Telemetry、Cache/Economics 与 Realized Net Value Controller](T38-telemetry-economics.md) | T24, T26, T31, T37 | `calculateRealizedNetValue` |
| T39 | W4 | [实现 Recall/Search/Status/Pin 工具与运维命令](T39-runtime-tools-commands.md) | T16, T18, T19, T22, T28 | `registerRuntimeTools` |
| T40 | W4 | [实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理](T40-package-install-conflicts.md) | T04, T05, T27, T31, T39 | `runRuntimeDoctor` |
| T41 | W4 | [运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO](T41-performance-spikes.md) | T06, T07, T18, T26, T31 | `runPerformanceSpikes` |
| T42 | W4 | [实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution](T42-benchmark-harness.md) | T27, T31, T38, T41 | `runBenchmarkSuite` |
| T43 | W4 | [实现 Memory Poisoning、Secret、Authority、Cursor 与 Recovery Fuzz/Mutation Suite](T43-security-fuzz.md) | T07, T10, T15, T22, T31, T36 | `runSecuritySuite` |
| T44 | W4 | [实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics](T44-pi-compatibility-ci.md) | T05, T27, T31, T40 | `verifyPiCompatibility` |
| T45 | W5 | [执行 Deterministic MVP Release Gate 与 Stop/Continue 决策](T45-deterministic-mvp-gate.md) | T33, T39, T40, T41, T42, T43, T44 | `evaluateDeterministicMvpGate` |
| T46 | W5 | [执行 Semantic/Background Beta Gate 与 Ablation 决策](T46-semantic-beta-gate.md) | T34, T35, T36, T37, T38, T45 | `evaluateSemanticBetaGate` |
| T47 | W5 | [实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具](T47-operations-cli.md) | T06, T07, T08, T40, T45 | `createWorkspaceBackup` |
| T48 | W5 | [完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证](T48-release-packaging.md) | T44, T45, T46, T47 | `buildReleaseArtifact` |
