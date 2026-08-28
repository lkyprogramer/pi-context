# 风险登记

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

登记 Pi-first 方案的概率、影响、控制、检测和触发处置。

## 2. 已冻结决策

- 未知 Context Handler 冲突是高风险且宿主无法强制消除。
- Pi pre-hook full-history clone 是长期性能风险。
- 跨存储非原子是故障一致性风险。
- 用户约束漏检和 Cache 崩塌为独立 P0 风险。

## 3. Top Risks

| ID | 风险 | P/I | 主要控制 |
|---|---|---|---|
| R01 | Pi public API 0.x 演进 | M/H | thin adapter、compat CI、runtime probe |
| R02 | 未知 context owner 覆盖输出 | H/H | single package、known conflict deny、integrity probe、unsupported status |
| R03 | Pi full history clone 膨胀 | H/H | periodic host compaction、clone benchmark/threshold |
| R04 | Tool raw result 已被前序插件改写 | M/H | conflict policy、single rewriter deployment |
| R05 | JSONL/SQLite/CAS 不一致 | M/H | Saga WAL、idempotence、startup recovery |
| R06 | Directive 漏检 | H/H | raw input archive、hard directive lane、proactive recall |
| R07 | Prefix cache 命中坍塌 | H/H | four-zone layout、cache gate |
| R08 | Semantic laundering | M/H | source-bound authority、verifier/action gate |
| R09 | Branch 数据串扰 | M/H | lineage scope、ancestry selection、physical workspace DB |
| R10 | Secret/PII 泄漏 | M/C | encryption、scrub、no raw telemetry、security corpus |
| R11 | Background stale 浪费 | H/M | complete candidate key、cancel、realized metrics |
| R12 | node:sqlite/FTS runtime variation | M/M | Node floor、capability probe、exact-only mode |
| R13 | Action gate 误阻断 | M/H | query/command classification、approval path、audit |
| R14 | Storage key loss | L/C | export/backup/rotation/explicit recovery policy |

## 4. 不变量

1. 风险关闭必须指向测试/遥测证据。
2. “用户自行确保插件顺序”不能作为唯一控制。

## 5. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 6. 关联资料

- `checklists/risk-review.md`
- `45-source-and-review-disposition.md`
