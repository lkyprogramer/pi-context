# Benchmark 端到端运行手册

> 规格版本：`1.0.0`  
> 研究快照：`2026-08-27`  
> Pi 固定参考：`ccfe79ed238674f760c986e3a61493aab794000a` / `@earendil-works/pi-coding-agent@0.84.3`


## 1. 一次完整 W1 Gate

```bash
pnpm benchmark:doctor --profile configs/w1-gate.json
pnpm benchmark:freeze --corpus benchmarks/corpus/manifest.json --out artifacts/frozen
pnpm benchmark:run --profile configs/w1-gate.json --arms A0,A1,A2 --out artifacts/runs/w1
pnpm benchmark:score --run artifacts/runs/w1/run-manifest.json
pnpm benchmark:gate --gate w1-early-net-value --report artifacts/runs/w1/report.json
pnpm benchmark:verify --run artifacts/runs/w1/run-manifest.json
```

每一步生成不可变 Artifact；后一步只读取前一步哈希引用，不回写输入。

## 2. 一次完整 W2 Gate

```bash
pnpm benchmark:run --profile configs/w2-gate.json --arms B0,B1,B2 --out artifacts/runs/w2
pnpm benchmark:reader --run artifacts/runs/w2/run-manifest.json
pnpm benchmark:continue --run artifacts/runs/w2/run-manifest.json
pnpm benchmark:score --run artifacts/runs/w2/run-manifest.json
pnpm benchmark:gate --gate w2-compactor --report artifacts/runs/w2/report.json
```

## 3. 运行前 Doctor

必须检查：

- Pi 版本、tarball integrity 与 capability probe；
- Node/OS/arch；
- Provider/model 版本与凭证可用性；
- 每个 Arm 独立 Pi Home、Workspace 和 Runtime Store；
- 所有 Snapshot/Oracle/Config hashes；
- 端口、临时目录和进程清洁；
- 未加载冲突的 `context`、`tool_result`、`session_before_compact` owner；
- Cache-on/off 模式与 Provider Session 隔离策略。

## 4. 失败处理

- `arm-failure`：计入该 Arm 失败；
- `infrastructure-failure`：所有 Arm 同一 pair 作废并整体重跑；
- `oracle-invalid`：整 Scenario 从当前 corpus version 移除，创建新 version；
- `composition-invalid`：该 Run 不进入统计，修复扩展组合后重跑；
- `hash-mismatch`：立即停止并进入完整性调查。

## 5. 结果目录

```text
artifacts/runs/<run-id>/
  run-manifest.json
  arm-manifests/
  artifacts/
  static-scores/
  reader-results/
  continuation-results/
  recall-results/
  economics/
  judge-records/
  report.json
  gate-decision.json
  logs/
```

所有文件均通过 SHA-256 被 `run-manifest.json` 引用。
