# File Index

本索引列出文档包内除 `MANIFEST.sha256` 与本索引自身外的文件。

## root

| File | Purpose | Bytes |
|---|---|---:|
| `00-executive-summary.md` | 执行摘要 | 3162 |
| `01-gap-audit-of-current-pcr-benchmark.md` | 现有 PCR Benchmark 规格缺口审计 | 2240 |
| `02-what-can-be-computed-directly.md` | 哪些可以直接计算，哪些不能 | 2397 |
| `03-evaluation-layers.md` | 三层主评测与一层辅助评审 | 1688 |
| `04-experimental-arms-and-factorial-design.md` | 实验臂与分阶段 Factorial 设计 | 2403 |
| `05-frozen-trace-and-boundary-snapshot.md` | 冻结 Raw Trace 与 Boundary Snapshot | 1870 |
| `06-oracle-and-ground-truth.md` | Oracle 与 Ground Truth 设计 | 1921 |
| `07-static-artifact-scoring.md` | 静态压缩产物评分 | 1756 |
| `08-deterministic-semantic-coverage.md` | 确定性语义覆盖与 Claim Normalization | 1571 |
| `09-reader-isolated-evaluation.md` | Reader-isolated Probe 评测 | 1809 |
| `10-paired-closed-loop-continuation.md` | Paired Closed-loop Continuation | 2061 |
| `11-tool-result-recoverability.md` | Tool Result 可恢复性评测 | 1368 |
| `12-proactive-recall-evaluation.md` | 主动 Recall 正收益评测 | 1407 |
| `13-token-latency-cache-cost.md` | Token、延迟、Prompt Cache 与成本 | 1596 |
| `14-llm-as-judge-protocol.md` | LLM-as-Judge 使用协议 | 1457 |
| `15-statistics-and-noninferiority.md` | 统计、Non-inferiority 与样本规则 | 1808 |
| `16-w1-early-net-value-gate.md` | W1 Early Net Value Gate | 2292 |
| `17-w2-compactor-head-to-head-gate.md` | W2 Compactor Head-to-head Gate | 1858 |
| `18-benchmark-corpus-design.md` | Benchmark Corpus 设计 | 1624 |
| `19-pi-benchmark-harness.md` | Pi Benchmark Harness 集成 | 1636 |
| `20-reproducibility-and-run-manifest.md` | 可复现性与 Run Manifest | 1266 |
| `21-reporting-and-failure-attribution.md` | 报告与失败归因 | 1189 |
| `22-security-and-governance-suite.md` | 安全与 Governance Constraint Suite | 1125 |
| `23-limitations-and-bias.md` | 局限、偏差与解释边界 | 1278 |
| `24-integration-into-pcr-roadmap.md` | 集成到 PCR Roadmap 的修改建议 | 1310 |
| `25-ai-agent-execution-protocol.md` | AI Agent 自主执行协议 | 1249 |
| `26-release-gates.md` | Benchmark Package 发布门 | 899 |
| `27-sources-and-method-notes.md` | 来源与方法说明 | 1124 |
| `28-reference-algorithms-and-formulas.md` | 参考算法、归一化与评分公式 | 3698 |
| `29-benchmark-runbook.md` | Benchmark 端到端运行手册 | 2326 |
| `30-pi-native-vs-pcr-comparison-protocol.md` | Pi Native 与 PCR 上下文算法正面对比协议 | 2155 |
| `ARTIFACT-STATS.json` | pi-context-compression-benchmark-spec | 492 |
| `BUILD-INFO.json` | pi-context-compression-benchmark-spec | 203 |
| `CHANGELOG.md` | Changelog | 535 |
| `GLOSSARY.md` | Glossary | 901 |
| `README.md` | Pi 上下文压缩算法比较与 Early Net Value Gate 完整规格 | 3428 |
| `SOURCE-SNAPSHOT.json` | Machine-readable artifact | 662 |
| `VALIDATION.md` | Validation Record | 2089 |

## adrs

| File | Purpose | Bytes |
|---|---|---:|
| `adrs/0001-three-layer-evaluation.md` | ADR 0001 — 采用三层主评测 | 333 |
| `adrs/0002-no-single-llm-judge.md` | ADR 0002 — 禁止单一 LLM Judge 作为真相 | 312 |
| `adrs/0003-w1-is-not-a-compactor.md` | ADR 0003 — W1 不作为独立压缩器比较 | 301 |
| `adrs/0004-canonical-raw-trace.md` | ADR 0004 — 所有实验从 RawTrace 重放 | 314 |
| `adrs/0005-oracle-first-scoring.md` | ADR 0005 — Oracle-first | 312 |
| `adrs/0006-boundary-local-continuation.md` | ADR 0006 — 边界局部闭环续跑 | 287 |
| `adrs/0007-lexicographic-gates.md` | ADR 0007 — 词典序 Gate | 272 |
| `adrs/0008-immutable-run-artifacts.md` | ADR 0008 — 运行产物不可变 | 287 |
| `adrs/0009-fixed-reader-ceiling.md` | ADR 0009 — 固定 Reader 与 Full-context Ceiling | 294 |
| `adrs/0010-paired-statistics.md` | ADR 0010 — 使用 Paired 统计 | 282 |

## checklists

| File | Purpose | Bytes |
|---|---|---:|
| `checklists/corpus.md` | Corpus Checklist | 385 |
| `checklists/gate.md` | Gate Checklist | 335 |
| `checklists/judge.md` | LLM Judge Checklist | 311 |
| `checklists/reproducibility.md` | Reproducibility Checklist | 311 |
| `checklists/run.md` | Run Checklist | 353 |
| `checklists/scoring.md` | Scoring Checklist | 370 |

## configs

| File | Purpose | Bytes |
|---|---|---:|
| `configs/ci.json` | ci | 284 |
| `configs/publication.json` | publication | 377 |
| `configs/smoke.json` | smoke | 339 |
| `configs/w1-gate.json` | w1-gate | 422 |
| `configs/w2-gate.json` | w2-gate | 421 |

## corpus

| File | Purpose | Bytes |
|---|---|---:|
| `corpus/README.md` | Benchmark Corpus 模板 | 903 |

## corpus/templates

| File | Purpose | Bytes |
|---|---|---:|
| `corpus/templates/branch-side-effect.scenario.json` | Machine-readable artifact | 1347 |
| `corpus/templates/delayed-must-not-deploy.scenario.json` | Machine-readable artifact | 1312 |
| `corpus/templates/large-build-log.scenario.json` | Machine-readable artifact | 1287 |
| `corpus/templates/recall-needed-old-error.scenario.json` | Machine-readable artifact | 1313 |
| `corpus/templates/recall-not-needed-new-task.scenario.json` | Machine-readable artifact | 1247 |
| `corpus/templates/same-basename-files.scenario.json` | Machine-readable artifact | 1269 |
| `corpus/templates/secret-in-tool-output.scenario.json` | Machine-readable artifact | 1323 |
| `corpus/templates/single-huge-turn-tools.scenario.json` | Machine-readable artifact | 1287 |
| `corpus/templates/superseded-api-compat.scenario.json` | Machine-readable artifact | 1345 |
| `corpus/templates/temporal-deadline-update.scenario.json` | Machine-readable artifact | 1223 |
| `corpus/templates/test-fail-fix-pass.scenario.json` | Machine-readable artifact | 1368 |
| `corpus/templates/unknown-abstention.scenario.json` | Machine-readable artifact | 1279 |

## diagrams

| File | Purpose | Bytes |
|---|---|---:|
| `diagrams/01-evaluation-layers.mmd` | Mermaid diagram source | 266 |
| `diagrams/02-w1-arms.mmd` | Mermaid diagram source | 189 |
| `diagrams/03-w2-arms.mmd` | Mermaid diagram source | 173 |
| `diagrams/04-paired-continuation.mmd` | Mermaid diagram source | 253 |
| `diagrams/05-gate-order.mmd` | Mermaid diagram source | 270 |
| `diagrams/06-attribution.mmd` | Mermaid diagram source | 288 |
| `diagrams/07-recall-ablation.mmd` | Mermaid diagram source | 169 |

## examples

| File | Purpose | Bytes |
|---|---|---:|
| `examples/W1-GATE-WALKTHROUGH.md` | W1 Gate 计算示例 | 1342 |
| `examples/W2-COMPACTOR-WALKTHROUGH.md` | Pi Native 与 PCR Deterministic Compactor 对比示例 | 1318 |
| `examples/arm-a0.example.json` | Machine-readable artifact | 224 |
| `examples/arm-a2.example.json` | Machine-readable artifact | 220 |
| `examples/benchmark-config.example.json` | w1-gate | 422 |
| `examples/benchmark-report.example.json` | Machine-readable artifact | 437 |
| `examples/compression-artifact.example.json` | Machine-readable artifact | 600 |
| `examples/continuation-result.example.json` | Machine-readable artifact | 320 |
| `examples/continuation-scenario.example.json` | Machine-readable artifact | 252 |
| `examples/cost-metrics.example.json` | Machine-readable artifact | 272 |
| `examples/environment-assertion-result.example.json` | Machine-readable artifact | 206 |
| `examples/gate-decision.example.json` | Machine-readable artifact | 356 |
| `examples/llm-judge-record.example.json` | Machine-readable artifact | 434 |
| `examples/oracle.example.json` | Machine-readable artifact | 1373 |
| `examples/probe-result.example.json` | Machine-readable artifact | 259 |
| `examples/probe-suite.example.json` | Machine-readable artifact | 284 |
| `examples/recall-eval.example.json` | Machine-readable artifact | 185 |
| `examples/run-manifest.example.json` | Machine-readable artifact | 470 |
| `examples/static-score.example.json` | Machine-readable artifact | 283 |
| `examples/trace-snapshot.example.json` | Machine-readable artifact | 1105 |

## integration

| File | Purpose | Bytes |
|---|---|---:|
| `integration/README.md` | 集成到 `pi-context-runtime-greenfield-spec-v1.0.0` | 724 |
| `integration/pcr-task-remap.json` | Machine-readable artifact | 684 |

## plans

| File | Purpose | Bytes |
|---|---|---:|
| `plans/00-master-implementation-plan.md` | Pi Context Compression Benchmark Master Implementation Plan | 2482 |
| `plans/01-foundation-plan.md` | Foundation 与可复现输入实施计划 | 1073 |
| `plans/02-w1-evaluation-plan.md` | W1 Early Net Value 实施计划 | 974 |
| `plans/03-w2-compactor-plan.md` | W2 Compactor Head-to-head 实施计划 | 839 |
| `plans/04-corpus-plan.md` | Benchmark Corpus 构建计划 | 804 |
| `plans/05-reporting-plan.md` | 评分、统计与报告实施计划 | 738 |
| `plans/06-pcr-integration-plan.md` | 集成现有 PCR Roadmap 的计划 | 674 |
| `plans/07-ai-agent-autonomous-execution-plan.md` | AI Agent 自主执行与审查计划 | 812 |

## reference

| File | Purpose | Bytes |
|---|---|---:|
| `reference/README.md` | Reference Scorer | 341 |
| `reference/__init__.py` | Executable reference/validation script | 70 |
| `reference/reference_scorer.py` | Executable reference/validation script | 3422 |
| `reference/test_reference_scorer.py` | Executable reference/validation script | 2077 |

## reports

| File | Purpose | Bytes |
|---|---|---:|
| `reports/REPORT-TEMPLATE.md` | Benchmark Report Template | 1052 |

## schemas

| File | Purpose | Bytes |
|---|---|---:|
| `schemas/arm-manifest.schema.json` | ArmManifest | 1009 |
| `schemas/benchmark-config.schema.json` | BenchmarkConfig | 1319 |
| `schemas/benchmark-report.schema.json` | BenchmarkReport | 1267 |
| `schemas/benchmark-scenario.schema.json` | BenchmarkScenario | 1680 |
| `schemas/compression-artifact.schema.json` | CompressionArtifact | 1103 |
| `schemas/continuation-result.schema.json` | ContinuationResult | 1312 |
| `schemas/continuation-scenario.schema.json` | ContinuationScenario | 644 |
| `schemas/cost-metrics.schema.json` | CostMetrics | 1045 |
| `schemas/environment-assertion-result.schema.json` | EnvironmentAssertionResult | 643 |
| `schemas/gate-decision.schema.json` | GateDecision | 988 |
| `schemas/llm-judge-record.schema.json` | LlmJudgeRecord | 1110 |
| `schemas/oracle.schema.json` | Oracle | 2576 |
| `schemas/probe-result.schema.json` | ProbeResult | 861 |
| `schemas/probe-suite.schema.json` | ProbeSuite | 1032 |
| `schemas/recall-eval.schema.json` | RecallEval | 853 |
| `schemas/run-manifest.schema.json` | RunManifest | 1046 |
| `schemas/static-score.schema.json` | StaticScore | 1227 |
| `schemas/trace-snapshot.schema.json` | TraceSnapshot | 2094 |

## scripts

| File | Purpose | Bytes |
|---|---|---:|
| `scripts/requirements.txt` | Artifact file | 19 |
| `scripts/taskctl.py` | Executable reference/validation script | 8048 |
| `scripts/test_taskctl.py` | Executable reference/validation script | 1135 |
| `scripts/validate_artifacts.py` | Executable reference/validation script | 9703 |

## tasks

| File | Purpose | Bytes |
|---|---|---:|
| `tasks/B01-benchmark-scaffold-and-contracts.md` | B01 — Benchmark Scaffold and Contracts | 7503 |
| `tasks/B02-rawtrace-capture-and-replay.md` | B02 — RawTrace Capture and Replay | 7910 |
| `tasks/B03-boundary-snapshot-and-restore.md` | B03 — Boundary Snapshot and Restore | 7278 |
| `tasks/B04-oracle-annotation-and-validation.md` | B04 — Oracle Annotation and Validation | 7460 |
| `tasks/B05-pi-native-arm-runner.md` | B05 — Pi Native Arm Runner | 7160 |
| `tasks/B06-w1-arms-a1-a2.md` | B06 — W1 Arms A1/A2 | 7026 |
| `tasks/B07-w2-compactor-arms-b0-b1-b2.md` | B07 — W2 Compactor Arms B0/B1/B2 | 7030 |
| `tasks/B08-static-artifact-scoring.md` | B08 — Static Artifact Scoring | 7070 |
| `tasks/B09-recoverability-suite.md` | B09 — Recoverability Suite | 7095 |
| `tasks/B10-proactive-recall-evaluation.md` | B10 — Proactive Recall Evaluation | 6630 |
| `tasks/B11-reader-isolated-probe-runner.md` | B11 — Reader-isolated Probe Runner | 6832 |
| `tasks/B12-paired-closed-loop-continuation.md` | B12 — Paired Closed-loop Continuation | 7416 |
| `tasks/B13-token-cache-cost-latency-instrumentation.md` | B13 — Token Cache Cost Latency Instrumentation | 7122 |
| `tasks/B14-blind-llm-judge.md` | B14 — Blind LLM Judge | 6922 |
| `tasks/B15-paired-statistics-and-non-inferiority.md` | B15 — Paired Statistics and Non-inferiority | 7013 |
| `tasks/B16-corpus-and-external-adapters.md` | B16 — Corpus and External Adapters | 6931 |
| `tasks/B17-report-and-gate-engine.md` | B17 — Report and Gate Engine | 7092 |
| `tasks/B18-pcr-integration-and-release.md` | B18 — PCR Integration and Release | 6765 |
| `tasks/EXECUTION-PROTOCOL.md` | Benchmark Task Execution Protocol | 522 |
| `tasks/README.md` | AI Agent Benchmark 实施任务 | 711 |
| `tasks/TASK-INDEX.json` | Machine-readable artifact | 14708 |
| `tasks/task-graph.json` | Machine-readable artifact | 1686 |

