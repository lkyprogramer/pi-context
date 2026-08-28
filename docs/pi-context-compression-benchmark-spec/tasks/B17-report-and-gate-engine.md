# B17 — Report and Gate Engine

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B09, B10, B15, B16  
**目标：** 从不可变结果生成 JSON-first 报告和词典序 W1/W2 Gate Decision。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B17
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B17-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-report/src/report.ts`
- `packages/benchmark-report/src/gates.ts`
- `packages/benchmark-report/src/failure-attribution.ts`
- `packages/benchmark-report/test/report.test.ts`
- `packages/benchmark-report/test/gates.test.ts`
- `scripts/run-gate.mjs`

此外只允许创建：

```text
artifacts/task-evidence/B17/red.txt
artifacts/task-evidence/B17/green.txt
artifacts/task-evidence/B17/negative.txt
artifacts/task-evidence/B17/full-gate.txt
artifacts/task-evidence/B17.json
```

## 3. 输入与输出合同

### Consumes

- 所有评分结果
- PairedStatisticsReport
- BenchmarkConfig
- RunManifest

### Produces

- evaluateBenchmarkGate()
- BenchmarkReport
- GateDecision
- renderReportMarkdown()

### 必须实现的公开接口

```ts
export function evaluateBenchmarkGate(input: GateEvaluationInput): GateDecision;
export function buildBenchmarkReport(input: ReportBuildInput): BenchmarkReport;
export function renderReportMarkdown(report: BenchmarkReport): string;
```

禁止后续 Task 导入本 Task 的私有文件；所有共享类型从 package root 导出。

## 4. 明确非目标

- 不修改 Pi 源码或导入 Pi 私有 `src/` 路径；
- 不更新 RawTrace、Oracle、Golden、Gate margin 来适应失败输出；
- 不把网络 Provider 调用放进 unit test；
- 不实现依赖图中后续 Task 的功能；
- 不使用单一 LLM Judge 覆盖确定性失败。

## 5. TDD 执行步骤

### Step 1 — 写具体 RED

在 `packages/benchmark-report/test/report.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("stops on integrity failure despite large token savings", () => {
  const d = evaluateBenchmarkGate(reportFixture({ integrityPass: false, medianTokenDelta: -0.9 }));
  expect(d.decision).toBe("stop");
});

it("returns keep-reducers-only when ingress passes but proactive recall fails", () => {
  const d = evaluateBenchmarkGate(w1PartialFixture());
  expect(d.decision).toBe("keep-reducers-only");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function reportFixture(overrides: Partial<GateEvaluationInput> = {}): GateEvaluationInput {
  return {
    gate: "w1-early-net-value", integrityPass: true, qualityCiLower: -0.01,
    qualityMargin: 0.03, ingressTokenMedianDelta: -0.24, ingressTokenCiUpper: -0.12,
    hookP95Ms: 40, recallAt5: 0.95, recallPrecision: 0.82, silenceRate: 0.93,
    recallQualityCiLower: -0.005, recallQualityMargin: 0.01,
    recallNeededSuccessDelta: 0.04, realizedNetMedian: 0.01, ...overrides,
  };
}
function w1PartialFixture(): GateEvaluationInput {
  return reportFixture({ recallAt5: 0.5, recallNeededSuccessDelta: 0 });
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B17
set -o pipefail
pnpm vitest run packages/benchmark-report/test/report.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B17/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-report/src/report.ts` 先写类型和最小实现。实现必须遵循：

1. 先验证 Run/Config/Corpus/Artifact hashes。
2. 按 Integrity→Quality→Recall→Efficiency 词典序执行。
3. W1/W2 使用独立函数和允许决策枚举。
4. 失败归因由证据规则产生；Unknown 不强行分类。
5. Markdown/HTML 只从 Report JSON 渲染。
6. Gate Engine 运行时文件系统只读，输出写新目录。

### Step 4 — 增加负例与故障测试

- [ ] 每个 allowed decision
- [ ] margin 边界等号
- [ ] CI 缺失
- [ ] 样本不足
- [ ] hash mismatch
- [ ] partial W1
- [ ] W2 quality failure
- [ ] report deterministic render

```bash
set -o pipefail
pnpm vitest run packages/benchmark-report/test/report.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B17/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-report/test/report.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B17/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B17/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B17.json` 必须记录：

```json
{
  "taskId": "B17",
  "allowedFiles": ["packages/benchmark-report/src/report.ts", "packages/benchmark-report/src/gates.ts", "packages/benchmark-report/src/failure-attribution.ts", "packages/benchmark-report/test/report.test.ts", "packages/benchmark-report/test/gates.test.ts", "scripts/run-gate.mjs"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B17/red.txt",
  "greenLog": "artifacts/task-evidence/B17/green.txt",
  "negativeLog": "artifacts/task-evidence/B17/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B17/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B17
python3 scripts/taskctl.py verify-evidence B17
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-report/src/report.ts packages/benchmark-report/src/gates.ts packages/benchmark-report/src/failure-attribution.ts packages/benchmark-report/test/report.test.ts packages/benchmark-report/test/gates.test.ts scripts/run-gate.mjs artifacts/task-evidence/B17
git commit -m "feat(b17): Report and Gate Engine"
python3 scripts/taskctl.py record-commit B17 HEAD
```

## 6. 完成验收

- [ ] Gate 决策可由 report+config 重算
- [ ] 没有手工编辑结论
- [ ] 所有 failure IDs 链到原始 run
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
