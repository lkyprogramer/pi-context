# T41 — 运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W4`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T41` 必须为 `pending` 或已解除 `blocked`  
**目标：** 运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `runPerformanceSpikes`

## 1. 先决条件

- [`T06`](T06-sqlite-store.md)：必须存在状态 `done` 和 evidence。
- [`T07`](T07-encrypted-blob-cas.md)：必须存在状态 `done` 和 evidence。
- [`T18`](T18-fts-catalog.md)：必须存在状态 `done` 和 evidence。
- [`T26`](T26-materializer.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T06.json, artifacts/task-evidence/T07.json, artifacts/task-evidence/T18.json, artifacts/task-evidence/T26.json, artifacts/task-evidence/T31.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T41
python3 scripts/taskctl.py claim T41 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T41: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T41: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`39-performance-slo.md`](../39-performance-slo.md)
- [`33-observability-and-economics.md`](../33-observability-and-economics.md)

- [`adrs/0002-hybrid-request-view-and-host-compaction.md`](../adrs/0002-hybrid-request-view-and-host-compaction.md)
- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)

## 3. 文件边界

### Create

- tests/performance/pi-clone.bench.ts
- tests/performance/cas-fsync.bench.ts
- tests/performance/sqlite-fts.bench.ts
- tests/performance/materializer.bench.ts
- tests/performance/host-compaction.bench.ts
- scripts/run-performance-spikes.mjs
- reports/performance/.gitkeep

### Modify

- package.json

### Tests

- tests/performance/pi-clone.bench.ts
- tests/performance/materializer.bench.ts

### Test fixture：Create or Modify

- tests/performance/support.ts

### Task Evidence

- artifacts/task-evidence/T41/red.txt
- artifacts/task-evidence/T41/green.txt
- artifacts/task-evidence/T41/full-gate.txt
- artifacts/task-evidence/T41.json

### 唯一允许写入集合

- tests/performance/pi-clone.bench.ts
- tests/performance/cas-fsync.bench.ts
- tests/performance/sqlite-fts.bench.ts
- tests/performance/materializer.bench.ts
- tests/performance/host-compaction.bench.ts
- scripts/run-performance-spikes.mjs
- reports/performance/.gitkeep
- package.json
- tests/performance/support.ts
- artifacts/task-evidence/T41/red.txt
- artifacts/task-evidence/T41/green.txt
- artifacts/task-evidence/T41/full-gate.txt
- artifacts/task-evidence/T41.json

修改集合外文件时必须停止，并创建 `blockers/T41-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T06 store
- T07 CAS
- T18 FTS
- T26 materializer
- T31 compaction

### Produces

- repeatable benchmark runner
- machine/env metadata
- P50/P95/P99/RSS/GC reports
- measured SLO recommendation

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 hardcode pass before measurement
- 不 compare different machines as regression
- 不 hide outliers

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { measureMaterializationFixture } from "./support.js";

describe("performance spike harness", () => {
  it("records distributions and machine metadata instead of asserting an invented latency", async () => {
    const report = await measureMaterializationFixture({ events: 100_000, iterations: 50 });
    expect(report.samples).toHaveLength(50);
    expect(report.environment.node).toMatch(/^v/);
    expect(report.p95Ms).toBeGreaterThanOrEqual(report.p50Ms);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T41
set -o pipefail
pnpm vitest run tests/performance/pi-clone.bench.ts tests/performance/materializer.bench.ts 2>&1 | tee artifacts/task-evidence/T41/red.txt
```

预期：失败原因是本任务主行为 `runPerformanceSpikes` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function runPerformanceSpikes(cases: BenchmarkCase[], env: BenchmarkEnvironment): Promise<PerformanceReport> {
  const results = [];
  for (const testCase of cases) results.push(await runIsolatedCase(testCase, env));
  return { environment: env, results, generatedAt: new Date().toISOString() };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] cold/warm
- [ ] Linux/macOS
- [ ] normal/full durability
- [ ] FTS 1M docs
- [ ] Pi clone from 1K/10K/100K messages
- [ ] host compaction steady-state soak

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/performance/pi-clone.bench.ts tests/performance/materializer.bench.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T41/green.txt
```

任务修改最终 app 时，再运行：

```bash
pnpm --filter ./apps/pi-context-runtime typecheck
```

- [ ] **Step 6：运行受影响包和全局边界门**

```bash
set -o pipefail
{
  pnpm check:boundaries
  pnpm test
} 2>&1 | tee artifacts/task-evidence/T41/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T41.json`：

```json
{
  "taskId": "T41",
  "status": "done",
  "allowedFiles": ["tests/performance/pi-clone.bench.ts", "tests/performance/cas-fsync.bench.ts", "tests/performance/sqlite-fts.bench.ts", "tests/performance/materializer.bench.ts", "tests/performance/host-compaction.bench.ts", "scripts/run-performance-spikes.mjs", "reports/performance/.gitkeep", "package.json", "tests/performance/support.ts", "artifacts/task-evidence/T41/red.txt", "artifacts/task-evidence/T41/green.txt", "artifacts/task-evidence/T41/full-gate.txt", "artifacts/task-evidence/T41.json"],
  "redLog": "artifacts/task-evidence/T41/red.txt",
  "greenLog": "artifacts/task-evidence/T41/green.txt",
  "fullGateLog": "artifacts/task-evidence/T41/full-gate.txt",
  "sourceDigest": "由 taskctl seal-evidence 计算；仅覆盖实现、测试和日志，不覆盖本 JSON",
  "acceptance": {
    "testsPassed": true,
    "typecheckPassed": true,
    "boundariesPassed": true,
    "scopeRespected": true
  }
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence T41
python3 scripts/taskctl.py verify-evidence T41
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add tests/performance/pi-clone.bench.ts tests/performance/cas-fsync.bench.ts tests/performance/sqlite-fts.bench.ts tests/performance/materializer.bench.ts tests/performance/host-compaction.bench.ts scripts/run-performance-spikes.mjs reports/performance/.gitkeep package.json tests/performance/support.ts artifacts/task-evidence/T41/red.txt artifacts/task-evidence/T41/green.txt artifacts/task-evidence/T41/full-gate.txt artifacts/task-evidence/T41.json
git commit -m "feat(t41): 运行 Clone/CAS/SQLite/FTS/Materialization/Compaction 性能 Spike 并冻结 SLO"
python3 scripts/taskctl.py record-commit T41 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：repeatable benchmark runner
- [ ] 完成：machine/env metadata
- [ ] 完成：P50/P95/P99/RSS/GC reports
- [ ] 完成：measured SLO recommendation
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T41` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- fresh report path/hash
- SLO doc updated from evidence
- kill criteria evaluated

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
