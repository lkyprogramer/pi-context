# 性能 SLO 与 Spike

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义前台路径、存储、检索、Compaction、background 和 Pi full-history clone 的实测要求。

## 2. 已冻结决策

- 所有 SLO 是 Spike Target，实测后冻结。
- 前台 Tool Result raw capture 与 Context Materialization 分开测。
- Pi `structuredClone` 成本必须作为宿主基线。
- macOS/Linux durability 分开。

## 3. Initial Targets

| 路径 | 初始目标 |
|---|---|
| context materialization warm P95 | ≤ 50 ms（不含 Pi pre-hook clone） |
| exact read P95 | ≤ 20 ms |
| FTS query P95 | ≤ 40 ms @ 1M docs fixture |
| tool raw capture+CAS P95 | ≤ 25 ms for 256KB；大对象 streaming spool |
| storage RPC P95 | ≤ 10 ms trivial query |
| host checkpoint deterministic build P95 | ≤ 100 ms |
| shutdown flush | ≤ 2 s，超时留下 recovery marker |

## 4. Pi Clone Benchmark

构造 10K/100K/1M tokens 与 1K/10K messages fixture，测 Context Handler 前 clone latency/peak RSS。Host convergence thresholds 依据 P95 曲线，不凭经验固定。

## 5. Disk/Durability

普通 fsync、macOS F_FULLFSYNC 等价策略、WAL checkpoint、CAS large blob、GC、key rotate 单独报告。无法达标时调整 SLO 或架构，不在 release gate 静默跳过。

## 6. 不变量

1. Performance test 使用固定机器描述和冷/warm 标记。
2. 禁止把 background 时间计入“0ms”宣称。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `tasks/T41-performance-spikes.md`
- `checklists/performance.md`
