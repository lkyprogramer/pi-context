# 文件索引

本索引覆盖文档包内的设计规格、开发任务、机器可读合同、参考骨架和验证资产。路径均相对于文档包根目录。

## 根目录与总览

| 文件 | 字节 |
|---|---:|
| [`ARTIFACT-STATS.json`](ARTIFACT-STATS.json) | 602 |
| [`BUILD-INFO.json`](BUILD-INFO.json) | 412 |
| [`GLOSSARY.md`](GLOSSARY.md) | 1,103 |
| [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md) | 409 |
| [`README.md`](README.md) | 2,903 |
| [`VALIDATION.md`](VALIDATION.md) | 3,705 |

## 编号规格文档

| 文件 | 字节 |
|---|---:|
| [`00-executive-summary.md`](00-executive-summary.md) | 2,509 |
| [`01-scope-and-success-criteria.md`](01-scope-and-success-criteria.md) | 2,360 |
| [`02-research-foundation.md`](02-research-foundation.md) | 2,037 |
| [`03-pi-integration-feasibility.md`](03-pi-integration-feasibility.md) | 2,226 |
| [`04-target-architecture.md`](04-target-architecture.md) | 2,290 |
| [`05-repository-and-package-layout.md`](05-repository-and-package-layout.md) | 2,126 |
| [`06-host-agnostic-contracts.md`](06-host-agnostic-contracts.md) | 2,979 |
| [`07-pi-public-api-mapping.md`](07-pi-public-api-mapping.md) | 2,708 |
| [`08-pi-session-tree-and-compaction-model.md`](08-pi-session-tree-and-compaction-model.md) | 2,134 |
| [`09-single-owner-governance.md`](09-single-owner-governance.md) | 1,883 |
| [`10-authorities-and-trust-boundaries.md`](10-authorities-and-trust-boundaries.md) | 2,057 |
| [`11-workspace-session-branch-identity.md`](11-workspace-session-branch-identity.md) | 1,662 |
| [`12-storage-engine.md`](12-storage-engine.md) | 2,080 |
| [`13-blob-cas-and-key-management.md`](13-blob-cas-and-key-management.md) | 1,803 |
| [`14-saga-and-recovery.md`](14-saga-and-recovery.md) | 2,108 |
| [`15-observation-ingress.md`](15-observation-ingress.md) | 1,979 |
| [`16-reducer-architecture.md`](16-reducer-architecture.md) | 2,051 |
| [`17-user-directive-lane.md`](17-user-directive-lane.md) | 2,004 |
| [`18-evidence-model.md`](18-evidence-model.md) | 1,893 |
| [`19-claims-and-authority.md`](19-claims-and-authority.md) | 1,844 |
| [`20-continuity-ledger.md`](20-continuity-ledger.md) | 1,910 |
| [`21-catalog-and-retrieval.md`](21-catalog-and-retrieval.md) | 1,768 |
| [`22-proactive-recall-and-leases.md`](22-proactive-recall-and-leases.md) | 1,704 |
| [`23-token-accounting-and-budget.md`](23-token-accounting-and-budget.md) | 1,817 |
| [`24-materialization.md`](24-materialization.md) | 2,295 |
| [`25-pi-context-hook.md`](25-pi-context-hook.md) | 1,979 |
| [`26-pi-tool-result-hook.md`](26-pi-tool-result-hook.md) | 2,065 |
| [`27-pi-compaction-takeover.md`](27-pi-compaction-takeover.md) | 2,458 |
| [`28-session-lifecycle-branching.md`](28-session-lifecycle-branching.md) | 1,918 |
| [`29-background-generation.md`](29-background-generation.md) | 1,693 |
| [`30-semantic-proposal-and-verifier.md`](30-semantic-proposal-and-verifier.md) | 1,869 |
| [`31-action-authorization.md`](31-action-authorization.md) | 1,741 |
| [`32-security-threat-model.md`](32-security-threat-model.md) | 1,950 |
| [`33-observability-and-economics.md`](33-observability-and-economics.md) | 1,848 |
| [`34-configuration.md`](34-configuration.md) | 1,862 |
| [`35-pi-package-installation.md`](35-pi-package-installation.md) | 1,894 |
| [`36-compatibility-versioning.md`](36-compatibility-versioning.md) | 1,832 |
| [`37-testing-strategy.md`](37-testing-strategy.md) | 1,868 |
| [`38-benchmark-evaluation.md`](38-benchmark-evaluation.md) | 2,048 |
| [`39-performance-slo.md`](39-performance-slo.md) | 1,736 |
| [`40-release-gates.md`](40-release-gates.md) | 1,722 |
| [`41-operations-and-troubleshooting.md`](41-operations-and-troubleshooting.md) | 1,513 |
| [`42-roadmap.md`](42-roadmap.md) | 1,974 |
| [`43-risk-register.md`](43-risk-register.md) | 2,232 |
| [`44-ai-agent-execution-protocol.md`](44-ai-agent-execution-protocol.md) | 2,040 |
| [`45-source-and-review-disposition.md`](45-source-and-review-disposition.md) | 1,868 |

## 架构决策 ADR

| 文件 | 字节 |
|---|---:|
| [`adrs/0001-host-agnostic-kernel-pi-first.md`](adrs/0001-host-agnostic-kernel-pi-first.md) | 886 |
| [`adrs/0002-hybrid-request-view-and-host-compaction.md`](adrs/0002-hybrid-request-view-and-host-compaction.md) | 895 |
| [`adrs/0003-single-pi-extension-owner.md`](adrs/0003-single-pi-extension-owner.md) | 810 |
| [`adrs/0004-public-pi-api-only.md`](adrs/0004-public-pi-api-only.md) | 838 |
| [`adrs/0005-dual-authority-boundary.md`](adrs/0005-dual-authority-boundary.md) | 809 |
| [`adrs/0006-physical-workspace-isolation.md`](adrs/0006-physical-workspace-isolation.md) | 810 |
| [`adrs/0007-sqlite-single-writer-worker.md`](adrs/0007-sqlite-single-writer-worker.md) | 830 |
| [`adrs/0008-encrypted-content-addressed-blobs.md`](adrs/0008-encrypted-content-addressed-blobs.md) | 805 |
| [`adrs/0009-recoverable-saga-not-cross-store-acid.md`](adrs/0009-recoverable-saga-not-cross-store-acid.md) | 849 |
| [`adrs/0010-bitemporal-claims.md`](adrs/0010-bitemporal-claims.md) | 836 |
| [`adrs/0011-authenticated-directive-lane.md`](adrs/0011-authenticated-directive-lane.md) | 804 |
| [`adrs/0012-authority-bound-provenance.md`](adrs/0012-authority-bound-provenance.md) | 816 |
| [`adrs/0013-exact-first-retrieval.md`](adrs/0013-exact-first-retrieval.md) | 794 |
| [`adrs/0014-purpose-bound-leases.md`](adrs/0014-purpose-bound-leases.md) | 790 |
| [`adrs/0015-cache-stable-four-zone-layout.md`](adrs/0015-cache-stable-four-zone-layout.md) | 843 |
| [`adrs/0016-active-turn-suffix-is-atomic.md`](adrs/0016-active-turn-suffix-is-atomic.md) | 850 |
| [`adrs/0017-pi-native-compaction-as-host-convergence.md`](adrs/0017-pi-native-compaction-as-host-convergence.md) | 837 |
| [`adrs/0018-semantic-proposal-not-authority.md`](adrs/0018-semantic-proposal-not-authority.md) | 797 |
| [`adrs/0019-action-authorization-gate.md`](adrs/0019-action-authorization-gate.md) | 815 |
| [`adrs/0020-no-embedding-in-v1-correctness.md`](adrs/0020-no-embedding-in-v1-correctness.md) | 795 |
| [`adrs/0021-compat-lock-plus-runtime-probe.md`](adrs/0021-compat-lock-plus-runtime-probe.md) | 786 |
| [`adrs/0022-deterministic-mvp-before-semantic.md`](adrs/0022-deterministic-mvp-before-semantic.md) | 787 |
| [`adrs/README.md`](adrs/README.md) | 2,051 |

## AI Agent 开发任务

| 文件 | 字节 |
|---|---:|
| [`tasks/EXECUTION-PROTOCOL.md`](tasks/EXECUTION-PROTOCOL.md) | 2,703 |
| [`tasks/README.md`](tasks/README.md) | 7,693 |
| [`tasks/T01-workspace-scaffold.md`](tasks/T01-workspace-scaffold.md) | 8,896 |
| [`tasks/T02-canonical-contracts.md`](tasks/T02-canonical-contracts.md) | 8,474 |
| [`tasks/T03-canonical-encoding-hashes.md`](tasks/T03-canonical-encoding-hashes.md) | 8,177 |
| [`tasks/T04-single-extension-orchestrator.md`](tasks/T04-single-extension-orchestrator.md) | 8,383 |
| [`tasks/T05-pi-contract-harness.md`](tasks/T05-pi-contract-harness.md) | 8,423 |
| [`tasks/T06-sqlite-store.md`](tasks/T06-sqlite-store.md) | 8,821 |
| [`tasks/T07-encrypted-blob-cas.md`](tasks/T07-encrypted-blob-cas.md) | 8,738 |
| [`tasks/T08-saga-recovery.md`](tasks/T08-saga-recovery.md) | 8,527 |
| [`tasks/T09-raw-input-receipt.md`](tasks/T09-raw-input-receipt.md) | 9,025 |
| [`tasks/T10-user-directive-capture.md`](tasks/T10-user-directive-capture.md) | 8,670 |
| [`tasks/T11-tool-result-raw-capture.md`](tasks/T11-tool-result-raw-capture.md) | 8,913 |
| [`tasks/T12-reducer-registry.md`](tasks/T12-reducer-registry.md) | 8,777 |
| [`tasks/T13-shell-build-test-reducers.md`](tasks/T13-shell-build-test-reducers.md) | 8,240 |
| [`tasks/T14-builtin-tool-reducers.md`](tasks/T14-builtin-tool-reducers.md) | 8,059 |
| [`tasks/T15-evidence-units.md`](tasks/T15-evidence-units.md) | 9,228 |
| [`tasks/T16-exact-evidence-read.md`](tasks/T16-exact-evidence-read.md) | 7,929 |
| [`tasks/T17-literal-search-index.md`](tasks/T17-literal-search-index.md) | 8,194 |
| [`tasks/T18-fts-catalog.md`](tasks/T18-fts-catalog.md) | 8,230 |
| [`tasks/T19-proactive-recall.md`](tasks/T19-proactive-recall.md) | 8,531 |
| [`tasks/T20-claim-ledger.md`](tasks/T20-claim-ledger.md) | 8,167 |
| [`tasks/T21-claim-conflict-supersession.md`](tasks/T21-claim-conflict-supersession.md) | 8,022 |
| [`tasks/T22-outcome-attestation-action-gate.md`](tasks/T22-outcome-attestation-action-gate.md) | 9,239 |
| [`tasks/T23-continuity-ledger.md`](tasks/T23-continuity-ledger.md) | 8,708 |
| [`tasks/T24-token-accounting.md`](tasks/T24-token-accounting.md) | 8,374 |
| [`tasks/T25-active-turn-suffix.md`](tasks/T25-active-turn-suffix.md) | 8,434 |
| [`tasks/T26-materializer.md`](tasks/T26-materializer.md) | 9,003 |
| [`tasks/T27-context-hook-integration.md`](tasks/T27-context-hook-integration.md) | 8,857 |
| [`tasks/T28-retrieval-leases.md`](tasks/T28-retrieval-leases.md) | 8,511 |
| [`tasks/T29-host-checkpoint-renderer.md`](tasks/T29-host-checkpoint-renderer.md) | 8,463 |
| [`tasks/T30-deterministic-host-checkpoint.md`](tasks/T30-deterministic-host-checkpoint.md) | 8,736 |
| [`tasks/T31-compaction-takeover.md`](tasks/T31-compaction-takeover.md) | 8,972 |
| [`tasks/T32-host-convergence-controller.md`](tasks/T32-host-convergence-controller.md) | 8,487 |
| [`tasks/T33-session-lifecycle.md`](tasks/T33-session-lifecycle.md) | 8,973 |
| [`tasks/T34-background-candidates.md`](tasks/T34-background-candidates.md) | 8,952 |
| [`tasks/T35-semantic-proposal.md`](tasks/T35-semantic-proposal.md) | 8,443 |
| [`tasks/T36-verifier.md`](tasks/T36-verifier.md) | 8,906 |
| [`tasks/T37-generation-fencing.md`](tasks/T37-generation-fencing.md) | 8,546 |
| [`tasks/T38-telemetry-economics.md`](tasks/T38-telemetry-economics.md) | 8,684 |
| [`tasks/T39-runtime-tools-commands.md`](tasks/T39-runtime-tools-commands.md) | 9,304 |
| [`tasks/T40-package-install-conflicts.md`](tasks/T40-package-install-conflicts.md) | 9,024 |
| [`tasks/T41-performance-spikes.md`](tasks/T41-performance-spikes.md) | 9,162 |
| [`tasks/T42-benchmark-harness.md`](tasks/T42-benchmark-harness.md) | 8,623 |
| [`tasks/T43-security-fuzz.md`](tasks/T43-security-fuzz.md) | 9,140 |
| [`tasks/T44-pi-compatibility-ci.md`](tasks/T44-pi-compatibility-ci.md) | 8,940 |
| [`tasks/T45-deterministic-mvp-gate.md`](tasks/T45-deterministic-mvp-gate.md) | 8,565 |
| [`tasks/T46-semantic-beta-gate.md`](tasks/T46-semantic-beta-gate.md) | 8,446 |
| [`tasks/T47-operations-cli.md`](tasks/T47-operations-cli.md) | 9,132 |
| [`tasks/T48-release-packaging.md`](tasks/T48-release-packaging.md) | 9,022 |
| [`tasks/TASK-INDEX.json`](tasks/TASK-INDEX.json) | 17,549 |
| [`tasks/task-graph.json`](tasks/task-graph.json) | 16,746 |
| [`tasks/task-status.template.jsonl`](tasks/task-status.template.jsonl) | 7,248 |

## 实施计划

| 文件 | 字节 |
|---|---:|
| [`plans/00-master-implementation-plan.md`](plans/00-master-implementation-plan.md) | 8,812 |
| [`plans/01-w0-foundation-and-host-contract.md`](plans/01-w0-foundation-and-host-contract.md) | 4,660 |
| [`plans/02-w1-deterministic-value-slice.md`](plans/02-w1-deterministic-value-slice.md) | 6,202 |
| [`plans/03-w2-state-runtime-and-pi-convergence.md`](plans/03-w2-state-runtime-and-pi-convergence.md) | 7,876 |
| [`plans/04-w3-semantic-proposal-and-economics.md`](plans/04-w3-semantic-proposal-and-economics.md) | 3,525 |
| [`plans/05-w4-productization-evaluation-compatibility.md`](plans/05-w4-productization-evaluation-compatibility.md) | 4,169 |
| [`plans/06-w5-release-gates-and-operations.md`](plans/06-w5-release-gates-and-operations.md) | 3,130 |
| [`plans/07-autonomous-agent-execution-protocol.md`](plans/07-autonomous-agent-execution-protocol.md) | 634 |

## Pi Adapter 规格

| 文件 | 字节 |
|---|---:|
| [`pi-adapter/01-hook-contracts.md`](pi-adapter/01-hook-contracts.md) | 450 |
| [`pi-adapter/02-message-conversion.md`](pi-adapter/02-message-conversion.md) | 302 |
| [`pi-adapter/03-active-turn-boundary.md`](pi-adapter/03-active-turn-boundary.md) | 239 |
| [`pi-adapter/04-input-correlation.md`](pi-adapter/04-input-correlation.md) | 218 |
| [`pi-adapter/05-tool-result-capture.md`](pi-adapter/05-tool-result-capture.md) | 227 |
| [`pi-adapter/06-compaction-provider.md`](pi-adapter/06-compaction-provider.md) | 228 |
| [`pi-adapter/07-owner-conflicts.md`](pi-adapter/07-owner-conflicts.md) | 217 |
| [`pi-adapter/08-lifecycle-recovery.md`](pi-adapter/08-lifecycle-recovery.md) | 195 |
| [`pi-adapter/09-provider-payload-probe.md`](pi-adapter/09-provider-payload-probe.md) | 206 |
| [`pi-adapter/10-package-runtime.md`](pi-adapter/10-package-runtime.md) | 216 |
| [`pi-adapter/11-error-fallback.md`](pi-adapter/11-error-fallback.md) | 232 |
| [`pi-adapter/12-contract-tests.md`](pi-adapter/12-contract-tests.md) | 233 |
| [`pi-adapter/README.md`](pi-adapter/README.md) | 147 |

## Agent 执行 Playbooks

| 文件 | 字节 |
|---|---:|
| [`agent-playbooks/01-task-executor.md`](agent-playbooks/01-task-executor.md) | 589 |
| [`agent-playbooks/02-contract-reviewer.md`](agent-playbooks/02-contract-reviewer.md) | 584 |
| [`agent-playbooks/03-security-reviewer.md`](agent-playbooks/03-security-reviewer.md) | 594 |
| [`agent-playbooks/04-fault-reviewer.md`](agent-playbooks/04-fault-reviewer.md) | 560 |
| [`agent-playbooks/05-pi-compat-reviewer.md`](agent-playbooks/05-pi-compat-reviewer.md) | 598 |
| [`agent-playbooks/06-release-captain.md`](agent-playbooks/06-release-captain.md) | 1,019 |
| [`agent-playbooks/README.md`](agent-playbooks/README.md) | 138 |

## JSON Schema

| 文件 | 字节 |
|---|---:|
| [`schemas/README.md`](schemas/README.md) | 125 |
| [`schemas/benchmark-record.schema.json`](schemas/benchmark-record.schema.json) | 1,540 |
| [`schemas/claim.schema.json`](schemas/claim.schema.json) | 2,998 |
| [`schemas/continuity-ledger.schema.json`](schemas/continuity-ledger.schema.json) | 8,865 |
| [`schemas/evidence-unit.schema.json`](schemas/evidence-unit.schema.json) | 3,222 |
| [`schemas/generation-manifest.schema.json`](schemas/generation-manifest.schema.json) | 2,953 |
| [`schemas/host-checkpoint.schema.json`](schemas/host-checkpoint.schema.json) | 3,021 |
| [`schemas/host-message.schema.json`](schemas/host-message.schema.json) | 1,766 |
| [`schemas/host-session-cursor.schema.json`](schemas/host-session-cursor.schema.json) | 815 |
| [`schemas/lease.schema.json`](schemas/lease.schema.json) | 1,562 |
| [`schemas/materialization-input.schema.json`](schemas/materialization-input.schema.json) | 4,089 |
| [`schemas/materialized-view.schema.json`](schemas/materialized-view.schema.json) | 6,446 |
| [`schemas/observation-input.schema.json`](schemas/observation-input.schema.json) | 2,511 |
| [`schemas/observation-projection.schema.json`](schemas/observation-projection.schema.json) | 2,068 |
| [`schemas/prompt-cache-plan.schema.json`](schemas/prompt-cache-plan.schema.json) | 973 |
| [`schemas/raw-input-receipt.schema.json`](schemas/raw-input-receipt.schema.json) | 2,425 |
| [`schemas/retrieval-page.schema.json`](schemas/retrieval-page.schema.json) | 2,410 |
| [`schemas/retrieval-query.schema.json`](schemas/retrieval-query.schema.json) | 3,104 |
| [`schemas/runtime-config.schema.json`](schemas/runtime-config.schema.json) | 7,344 |
| [`schemas/saga-operation.schema.json`](schemas/saga-operation.schema.json) | 2,332 |
| [`schemas/task-status.schema.json`](schemas/task-status.schema.json) | 1,073 |
| [`schemas/telemetry-event.schema.json`](schemas/telemetry-event.schema.json) | 1,094 |
| [`schemas/user-directive.schema.json`](schemas/user-directive.schema.json) | 2,612 |
| [`schemas/verifier-report.schema.json`](schemas/verifier-report.schema.json) | 1,705 |

## 配置方案

| 文件 | 字节 |
|---|---:|
| [`configs/README.md`](configs/README.md) | 85 |
| [`configs/balanced.yaml`](configs/balanced.yaml) | 1,064 |
| [`configs/cost-first.yaml`](configs/cost-first.yaml) | 1,065 |
| [`configs/deterministic-minimal.yaml`](configs/deterministic-minimal.yaml) | 1,080 |
| [`configs/quality-first.yaml`](configs/quality-first.yaml) | 1,071 |
| [`configs/security-strict.yaml`](configs/security-strict.yaml) | 1,068 |

## 机器可读示例

| 文件 | 字节 |
|---|---:|
| [`examples/README.md`](examples/README.md) | 80 |
| [`examples/benchmark-record.json`](examples/benchmark-record.json) | 511 |
| [`examples/benchmark-records.jsonl`](examples/benchmark-records.jsonl) | 894 |
| [`examples/claim.json`](examples/claim.json) | 428 |
| [`examples/continuity-ledger.json`](examples/continuity-ledger.json) | 1,034 |
| [`examples/evidence-unit.json`](examples/evidence-unit.json) | 703 |
| [`examples/generation-manifest.json`](examples/generation-manifest.json) | 890 |
| [`examples/host-checkpoint.json`](examples/host-checkpoint.json) | 890 |
| [`examples/host-message.json`](examples/host-message.json) | 318 |
| [`examples/host-session-cursor.json`](examples/host-session-cursor.json) | 253 |
| [`examples/lease.json`](examples/lease.json) | 370 |
| [`examples/materialization-input.json`](examples/materialization-input.json) | 799 |
| [`examples/materialized-view.json`](examples/materialized-view.json) | 1,245 |
| [`examples/observation-input.json`](examples/observation-input.json) | 579 |
| [`examples/observation-projection.json`](examples/observation-projection.json) | 365 |
| [`examples/prompt-cache-plan.json`](examples/prompt-cache-plan.json) | 342 |
| [`examples/raw-input-receipt.json`](examples/raw-input-receipt.json) | 600 |
| [`examples/retrieval-page.json`](examples/retrieval-page.json) | 437 |
| [`examples/retrieval-query.json`](examples/retrieval-query.json) | 607 |
| [`examples/runtime-config.json`](examples/runtime-config.json) | 1,360 |
| [`examples/saga-operation.json`](examples/saga-operation.json) | 581 |
| [`examples/task-status.json`](examples/task-status.json) | 169 |
| [`examples/telemetry-event.json`](examples/telemetry-event.json) | 375 |
| [`examples/telemetry-events.jsonl`](examples/telemetry-events.jsonl) | 658 |
| [`examples/user-directive.json`](examples/user-directive.json) | 523 |
| [`examples/verifier-report.json`](examples/verifier-report.json) | 495 |

## Mermaid 图源

| 文件 | 字节 |
|---|---:|
| [`diagrams/01-system-architecture.mmd`](diagrams/01-system-architecture.mmd) | 219 |
| [`diagrams/02-request-lifecycle.mmd`](diagrams/02-request-lifecycle.mmd) | 328 |
| [`diagrams/03-observation-lifecycle.mmd`](diagrams/03-observation-lifecycle.mmd) | 292 |
| [`diagrams/04-storage-planes.mmd`](diagrams/04-storage-planes.mmd) | 160 |
| [`diagrams/05-directive-lane.mmd`](diagrams/05-directive-lane.mmd) | 168 |
| [`diagrams/06-claim-lifecycle.mmd`](diagrams/06-claim-lifecycle.mmd) | 208 |
| [`diagrams/07-continuity-fronts.mmd`](diagrams/07-continuity-fronts.mmd) | 153 |
| [`diagrams/08-retrieval-ladder.mmd`](diagrams/08-retrieval-ladder.mmd) | 161 |
| [`diagrams/09-cache-zones.mmd`](diagrams/09-cache-zones.mmd) | 239 |
| [`diagrams/10-host-compaction.mmd`](diagrams/10-host-compaction.mmd) | 282 |
| [`diagrams/11-saga-recovery.mmd`](diagrams/11-saga-recovery.mmd) | 227 |
| [`diagrams/12-background-generation.mmd`](diagrams/12-background-generation.mmd) | 260 |
| [`diagrams/13-action-gate.mmd`](diagrams/13-action-gate.mmd) | 208 |
| [`diagrams/14-pi-compatibility.mmd`](diagrams/14-pi-compatibility.mmd) | 150 |
| [`diagrams/15-task-waves.mmd`](diagrams/15-task-waves.mmd) | 261 |
| [`diagrams/16-security-flow.mmd`](diagrams/16-security-flow.mmd) | 237 |

## 检查表

| 文件 | 字节 |
|---|---:|
| [`checklists/ai-task-review.md`](checklists/ai-task-review.md) | 186 |
| [`checklists/architecture.md`](checklists/architecture.md) | 212 |
| [`checklists/compatibility.md`](checklists/compatibility.md) | 165 |
| [`checklists/operations.md`](checklists/operations.md) | 131 |
| [`checklists/performance.md`](checklists/performance.md) | 159 |
| [`checklists/release.md`](checklists/release.md) | 191 |
| [`checklists/risk-review.md`](checklists/risk-review.md) | 194 |
| [`checklists/security.md`](checklists/security.md) | 226 |
| [`checklists/testing.md`](checklists/testing.md) | 173 |

## 参考合同与骨架

| 文件 | 字节 |
|---|---:|
| [`reference/README.md`](reference/README.md) | 124 |
| [`reference/action-gate-skeleton.ts`](reference/action-gate-skeleton.ts) | 659 |
| [`reference/ci-matrix.yml`](reference/ci-matrix.yml) | 580 |
| [`reference/contracts.ts`](reference/contracts.ts) | 2,384 |
| [`reference/error-codes.md`](reference/error-codes.md) | 897 |
| [`reference/host-checkpoint-renderer.ts`](reference/host-checkpoint-renderer.ts) | 488 |
| [`reference/materializer-skeleton.ts`](reference/materializer-skeleton.ts) | 717 |
| [`reference/monorepo-tree.txt`](reference/monorepo-tree.txt) | 467 |
| [`reference/package-blueprint.json`](reference/package-blueprint.json) | 785 |
| [`reference/pi-extension-skeleton.ts`](reference/pi-extension-skeleton.ts) | 1,377 |
| [`reference/public-exports.md`](reference/public-exports.md) | 695 |
| [`reference/reducer-skeleton.ts`](reference/reducer-skeleton.ts) | 559 |
| [`reference/schema.sql`](reference/schema.sql) | 3,462 |
| [`reference/storage-rpc.ts`](reference/storage-rpc.ts) | 438 |
| [`reference/test-harness-skeleton.ts`](reference/test-harness-skeleton.ts) | 446 |

## 兼容性锁

| 文件 | 字节 |
|---|---:|
| [`compat/pi.lock.json`](compat/pi.lock.json) | 744 |

## 验证和调度脚本

| 文件 | 字节 |
|---|---:|
| [`scripts/README.md`](scripts/README.md) | 1,459 |
| [`scripts/generate_indexes.py`](scripts/generate_indexes.py) | 3,332 |
| [`scripts/generate_manifest.py`](scripts/generate_manifest.py) | 470 |
| [`scripts/requirements.txt`](scripts/requirements.txt) | 33 |
| [`scripts/taskctl.py`](scripts/taskctl.py) | 14,657 |
| [`scripts/validate_artifacts.py`](scripts/validate_artifacts.py) | 7,331 |
| [`scripts/validate_contract_consistency.py`](scripts/validate_contract_consistency.py) | 4,217 |
| [`scripts/validate_task_graph.py`](scripts/validate_task_graph.py) | 4,746 |

## 来源快照

| 文件 | 字节 |
|---|---:|
| [`sources/pi-source-map.md`](sources/pi-source-map.md) | 1,195 |
| [`sources/research-index.md`](sources/research-index.md) | 503 |
| [`sources/user-provided/claude-dcr-review.md`](sources/user-provided/claude-dcr-review.md) | 33,844 |
| [`sources/user-provided/context-compression-deep-research.md`](sources/user-provided/context-compression-deep-research.md) | 47,071 |
| [`sources/user-provided/context-compression-summary.md`](sources/user-provided/context-compression-summary.md) | 13,903 |
| [`sources/user-provided/dsh-design-review.md`](sources/user-provided/dsh-design-review.md) | 33,369 |
| [`sources/user-provided/dsh-pi-source-level-study.md`](sources/user-provided/dsh-pi-source-level-study.md) | 56,402 |
