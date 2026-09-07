# pi-context Native-First Evolution · v5.0.0

**完整调研、重构规格与 AI 可执行开发／验证包**  
审计基线：2026-09-06。文档版本不是现有插件的发布版本。

## 结论

不建议把 pi-context 再扩建成一套替代 Pi 的 Agent Runtime。建议重构为：**官方 Pi 原生会话之上的、证据可回读且缓存感知的上下文优化插件**。Pi 负责真实会话、分支、执行与压缩调度；插件只负责历史索引、可验证的工作状态、稳定周期的输出视图及受预算约束的回读。

“最佳”指在 **不修改官方 Pi、长期 Java Agent、质量优先、单机可维护** 这些约束下，本次证据支持度最高的选择；不是已经通过大规模实验确认的全局最优算法。

## 先读什么

| 读者／目的 | 入口 |
|---|---|
| 先看判断和取舍 | [00 执行摘要](docs/00-executive-summary.md) |
| 核对当前代码与报告 | [02 源码审计](docs/02-current-audit.md)、[03 历史方案对照](docs/03-history-and-deltas.md) |
| 理解完整架构 | [05 架构](docs/05-target-architecture.md)、[06 Pi 扩展边界](docs/06-pi-contract.md) |
| 交给开发 Agent | [AI-START-HERE](AI-START-HERE.md)、[任务目录](tasks/INDEX.md) |
| 独立测试与验收 | [13 测试策略](docs/13-test-strategy.md)、[14 实验与统计](docs/14-evaluation.md)、[Java 场景](cases/INDEX.md) |
| 核查依据与执行边界 | [来源索引](SOURCE-INDEX.md)、[01 研究方法](docs/01-method-and-evidence.md)、[验证说明](evidence/VERIFICATION.md) |

## 包内交付边界

已经完成的是研究、当前源码组件探针、完整设计、任务 DAG、接口／数据契约、测试案例和文档／统计校验脚本。**没有把 v5 产品实现好，也没有运行真实 Pi 集成或真实模型对照试验。** `contracts/` 是规范样本，`fixtures/` 是协议验收素材，不能把它们当成成品插件安装。

原始附件完整 Git tree 与远端观察到的 head 一致；详见 [基线证据](evidence/source-identity.json)。新架构的优化配置默认 `observe`，只有安全性、真实模型回读和闭环质量通过相应门禁后，才把 `balanced` 标为可推荐。

## 本文档包可直接运行的检查

```bash
python3 scripts/validate_bundle.py
python3 scripts/summarize_pairs.py fixtures/eval-pairs-example.jsonl
python3 scripts/test_eval_tools.py
```

第二条使用明确标为 `synthetic-example` 的数据，只验证统计工具，不代表插件实验。源码探针另见 [复跑说明](evidence/VERIFICATION.md)。

## 一次运行本包检查

```bash
nohup bash scripts/run_design_checks.sh --with-java > design-checks.log 2>&1 &
tail -f design-checks.log
```

该命令验证设计资料、统计工具及Java oracle，不运行尚待开发的v5插件，也不调用收费模型。

## 版本与资料优先级

本包 `docs/05…18`、`contracts/`、`tasks/` 为 v5 开发规范；`docs/02…04` 与 `evidence/` 是审计依据。旧仓库所有 v1–v4 设计保留为历史，不再作为并行的现行需求。修改规范必须同时修改受影响任务与测试，不以增加“再修订版目录”回避冲突。
