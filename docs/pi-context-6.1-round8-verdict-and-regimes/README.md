# pi-context 6.1 · 第 8 轮：让评测能给出真结论，并在正确的场景里测折叠

审计日：2026-09-11（Asia/Shanghai）。代码基线 `0e7fb400309612b106a28dcc89fe7f15d37b1b00`（`main`，工作树干净；`docs/pi-context-6.1-audit-next-steps/` 为未跟踪文档，不属于代码基线）。

这是第 7 轮包（`docs/pi-context-6.1-audit-next-steps/`，R01–R10）之后的修订计划。R01–R10 已全部落地并有对应提交；随后又有两个提交（`44e8333b`、`0e7fb400`）和三次完整的 36-episode live run。本包基于这些真实产出，回答三个问题：**为什么三次 run 都只能得到 `review-needed`；这些数字到底证明了什么；下一步该在哪里花 4090 的时间。**

**结论：插件机制层已达到 Q lane 能证明的上限（每个 balanced episode 都真实折叠、0 错误动作、16/18 次 hash 校验回读、native compaction 归零）；拿不到正向裁决的原因在评测侧（目标值从未计算、门对模型抖动零容忍、6.2 候选信号未接线）；经济收益被 resume 冷启动场景放大，真正该赢的会话中 / 长会话场景尚未测量。默认 observe 不变。**

## 阅读路径

[综合结论](audit/00-verdict.md) → [一致性对照](audit/01-consistency.md) → [问题清单与归因](audit/02-findings.md) → [run 证据解读](audit/03-run-evidence.md) → [目标设计](design/00-target.md) → [合同](design/01-contracts.md) → [AI 入口](AI-START-HERE.md) → [任务](tasks/README.md) → [协议](testing/00-protocol.md) → [运行手册](testing/01-runbook.md)。

## 包含与不包含

包含：三次 live run 的只读聚合（`evidence/run-aggregates.json`，可用 `scripts/aggregate_runs.py` 复算）、12 项问题及归因、7 个可执行任务（S01–S07）、修订后的判定规则、两条新场景 lane（warm / long）、完整性校验脚本。

不包含：已实现的修复、新的模型成绩、真实 API Key、任何会话正文或模型思考。`evidence/run-aggregates.json` 中的数字来自 `artifacts/local-eval/` 现有 run 的 `requests.jsonl/episodes.jsonl`，这些 run 均在 dirty tree 上产生，**只能作为诊断，不能作为交付证据**。

## 工作量边界

7 个任务。S01–S05 只需定向 Vitest + `pnpm typecheck`；S06 需要 Docker 与受控 Provider；只有 S07 消耗真模型（最多 84 个 episode，约 80–100 分钟 4090 时间，预算在 `testing/01-runbook.md` 冻结）。不改默认 observe、不改 60/40/4/4096、不新增语义后台、不重建旧 PCR。
