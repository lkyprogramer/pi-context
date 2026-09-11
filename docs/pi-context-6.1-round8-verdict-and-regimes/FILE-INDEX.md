# 文件索引

| 路径 | 内容 |
|---|---|
| `README.md` | 包概述、结论一句话、阅读路径、边界 |
| `AI-START-HERE.md` | AI 执行入口：顺序、每任务流程、禁区、完成判据 |
| `VALIDATION.md` | 本包校验方法与证据等级 |
| `FILE-INDEX.md` | 本文件 |
| `MANIFEST.sha256` | 全文件哈希 |
| `audit/00-verdict.md` | 综合结论：机制已到 Q lane 上限，评测侧阻塞结论，经济上限未测 |
| `audit/01-consistency.md` | 与第 7 轮包、6.1 原始计划的逐项一致性对照 |
| `audit/02-findings.md` | G01–G12 问题、归因（dev/test/process）、上限项 C01–C03 |
| `audit/findings.json` | 机器可读 findings → tasks |
| `audit/03-run-evidence.md` | 三次 dirty live run 的聚合、逐请求序列、机制解读、离线验收基准 |
| `design/00-target.md` | 见证规则、目标计算、判定规则、候选接线、Darwin 沙箱、lane 设计、6.2 候选、红线 |
| `design/01-contracts.md` | plan / pair / objective / decision / broker hop / verbatimQuote / cases.json 增补 / docs 一致性测试 |
| `tasks/README.md` | 7 任务总表与执行边界 |
| `tasks/index.json` | 任务 id、依赖、关闭 finding、文件范围、定向测试、验收 |
| `tasks/S01.md` … `tasks/S07.md` | 任务卡（RED 测试、实施顺序、负例、验收、Review focus） |
| `testing/00-protocol.md` | 分层、矩阵、目标与判定、regime 读数、预算、口径、安全、失败处理 |
| `testing/01-runbook.md` | 逐命令运行手册（每任务、G1 受控、G2 live、bundle、文档、阻塞处置） |
| `testing/scenarios.json` | 15 场景、4 lane、84 episode、主/次目标 |
| `evidence/run-aggregates.json` | 三次 run 的 Q lane 聚合（`scripts/aggregate_runs.py` 产出） |
| `evidence/inspected-files.json` | 本次审计读过的源码、提交、文档、产物与已运行命令 |
| `scripts/aggregate_runs.py` | 从 `artifacts/local-eval/<run>` 复算聚合 |
| `scripts/validate_bundle.py` | 本包结构与不变量校验 |
| `scripts/README.md` | 脚本说明与 manifest 重生成命令 |
