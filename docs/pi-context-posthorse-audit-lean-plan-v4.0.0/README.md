# Pi Context：Posthorse 对照审计与精简迭代包 v4.0.0

本包只针对 `bb7aea1b88f6645fb8e4f0b930a4087630e7a679`。它是审计与可执行实施规格，不是已修复的软件。研究日期 2026-09-06。

**决策：保留 Native 为默认压缩器；先修观察可见性、祖先证据权限、活动工具批次，再比较完整产品。暂不引入新的宿主 fork、语义后台、多层图谱或大规模发布流程。**

阅读路径：

| 目的 | 文件 |
|---|---|
| 结论、修好了什么、下一步 | [00-executive-summary.md](00-executive-summary.md) |
| 附件/提交/实验源码证据边界 | [01-baseline-and-evidence.md](01-baseline-and-evidence.md) |
| 上一版 C00–C31 对照 | [02-spec-consistency.md](02-spec-consistency.md)、[CSV](compliance/previous-plan.csv) |
| 具体源码缺陷和复现 | [03-runtime-audit.md](03-runtime-audit.md)、[原模块复现](evidence/isolated-reproductions.json) |
| 300组结果的重新解释 | [04-report-reanalysis.md](04-report-reanalysis.md) |
| Posthorse 源码机制与取舍 | [05-posthorse-study.md](05-posthorse-study.md) |
| 后续最小目标架构、公共合同 | [06-lean-design.md](06-lean-design.md)、[CONTRACTS.md](CONTRACTS.md) |
| 通用测试、分母、统计与集中验证 | [07-test-protocol.md](07-test-protocol.md) |
| 12个AI任务与执行边界 | [08-ai-execution.md](08-ai-execution.md)、[任务索引](tasks/index.json) |
| 凭据、日志、安装和回退 | [09-security-and-operation.md](09-security-and-operation.md) |
| 固定一手来源与定位 | [SOURCES.md](SOURCES.md) |
| 本包验证与未执行边界 | [VALIDATION.md](VALIDATION.md) |

## 可直接运行的包内工具

```bash
python3 scripts/verify_bundle.py
python3 -m unittest discover -s tests -v
# 从已有报告复算，不发起模型调用：
python3 scripts/recompute_report.py --input /path/to/report.json --output /tmp/pcr-recomputed.json
# 对附件原始模块做隔离复现；需目标仓库已有 TypeScript 依赖：
node scripts/reproduce_current.cjs /path/to/pi-context /tmp/pcr-repro.json
```

`reproduce_current.cjs` 的存储/宿主端口是测试替身，运行的是固定来源函数；不是完整 Pi 集成或 Provider 基准。`recompute_report.py` 不修正原报告分数，只改变聚合、报告分母和暴露限制。新方案的 `pnpm check:fast`、`check:local`、`eval:small` 由 T01/T08 创建，当前仓库没有这三个统一入口。

## 不再沿用的过程要求

不要求每个Task跑100×3、不要求每次全OS×全Node矩阵、不要求云端持有Provider密钥、不为个人试用强制多层Evidence封印或分支保护。保留一条本地完整验收、一个source/host/experiment身份、一份机器结果和原始失败记录。旧报告只读归档，绝不通过修改它们获得通过结论。
