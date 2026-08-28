# T42 — 实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W4`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T42` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `runBenchmarkSuite`

## 1. 先决条件

- [`T27`](T27-context-hook-integration.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。
- [`T38`](T38-telemetry-economics.md)：必须存在状态 `done` 和 evidence。
- [`T41`](T41-performance-spikes.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T27.json, artifacts/task-evidence/T31.json, artifacts/task-evidence/T38.json, artifacts/task-evidence/T41.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T42
python3 scripts/taskctl.py claim T42 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T42: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T42: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`38-benchmark-evaluation.md`](../38-benchmark-evaluation.md)
- [`37-testing-strategy.md`](../37-testing-strategy.md)

- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)
- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)

## 3. 文件边界

### Create

- benchmarks/src/runner.ts
- benchmarks/src/scenarios.ts
- benchmarks/src/scoring.ts
- benchmarks/src/paired-continuation.ts
- benchmarks/test/scoring.test.ts
- scripts/run-benchmarks.mjs

### Modify

- benchmarks/package.json

### Tests

- benchmarks/test/scoring.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T42/red.txt
- artifacts/task-evidence/T42/green.txt
- artifacts/task-evidence/T42/full-gate.txt
- artifacts/task-evidence/T42.json

### 唯一允许写入集合

- benchmarks/src/runner.ts
- benchmarks/src/scenarios.ts
- benchmarks/src/scoring.ts
- benchmarks/src/paired-continuation.ts
- benchmarks/test/scoring.test.ts
- scripts/run-benchmarks.mjs
- benchmarks/package.json
- artifacts/task-evidence/T42/red.txt
- artifacts/task-evidence/T42/green.txt
- artifacts/task-evidence/T42/full-gate.txt
- artifacts/task-evidence/T42.json

修改集合外文件时必须停止，并创建 `blockers/T42-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T27 context runtime
- T31 host checkpoint
- T38 telemetry
- T41 perf metadata

### Produces

- reproducible benchmark runner
- Pi native/billion-context/deterministic/semantic arms
- paired boundary continuation
- bootstrap CI and attribution

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 use one LLM judge as sole truth
- 不 compare different scenario sets
- 不 publish project self-report as proven gain

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { scoreConstraintRecall } from "../src/scoring.js";

describe("benchmark scoring", () => {
  it("distinguishes absent, contradicted and correctly applied constraints", () => {
    expect(scoreConstraintRecall({ expected: "must-not deploy", observed: "did not deploy" })).toBe(1);
    expect(scoreConstraintRecall({ expected: "must-not deploy", observed: "deployed" })).toBe(0);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T42
set -o pipefail
pnpm vitest run benchmarks/test/scoring.test.ts 2>&1 | tee artifacts/task-evidence/T42/red.txt
```

预期：失败原因是本任务主行为 `runBenchmarkSuite` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function runBenchmarkSuite(config: BenchmarkConfig): Promise<BenchmarkReport> {
  const paired = await Promise.all(config.scenarios.flatMap((scenario) => config.arms.map((arm) => runScenarioArm(scenario, arm, config.seed))));
  return scoreAndBootstrap(paired, { confidence: 0.95, paired: true, attribution: ["compressor","retrieval","reader","executor"] });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] temporal/update/negation/abstention
- [ ] goal switch/park/resume
- [ ] large tool noise
- [ ] branch/external state
- [ ] cache economics
- [ ] security attacks
- [ ] same seed/environment

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run benchmarks/test/scoring.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T42/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T42/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T42.json`：

```json
{
  "taskId": "T42",
  "status": "done",
  "allowedFiles": ["benchmarks/src/runner.ts", "benchmarks/src/scenarios.ts", "benchmarks/src/scoring.ts", "benchmarks/src/paired-continuation.ts", "benchmarks/test/scoring.test.ts", "scripts/run-benchmarks.mjs", "benchmarks/package.json", "artifacts/task-evidence/T42/red.txt", "artifacts/task-evidence/T42/green.txt", "artifacts/task-evidence/T42/full-gate.txt", "artifacts/task-evidence/T42.json"],
  "redLog": "artifacts/task-evidence/T42/red.txt",
  "greenLog": "artifacts/task-evidence/T42/green.txt",
  "fullGateLog": "artifacts/task-evidence/T42/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T42
python3 scripts/taskctl.py verify-evidence T42
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add benchmarks/src/runner.ts benchmarks/src/scenarios.ts benchmarks/src/scoring.ts benchmarks/src/paired-continuation.ts benchmarks/test/scoring.test.ts scripts/run-benchmarks.mjs benchmarks/package.json artifacts/task-evidence/T42/red.txt artifacts/task-evidence/T42/green.txt artifacts/task-evidence/T42/full-gate.txt artifacts/task-evidence/T42.json
git commit -m "feat(t42): 实现 Paired Long-horizon Benchmark、Ablation 与 Quality Attribution"
python3 scripts/taskctl.py record-commit T42 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：reproducible benchmark runner
- [ ] 完成：Pi native/billion-context/deterministic/semantic arms
- [ ] 完成：paired boundary continuation
- [ ] 完成：bootstrap CI and attribution
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T42` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- deterministic assertions where possible
- raw result/hash/revision stored
- non-inferiority and kill criteria computed

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
