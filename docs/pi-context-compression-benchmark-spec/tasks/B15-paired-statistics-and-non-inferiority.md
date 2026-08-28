# B15 — Paired Statistics and Non-inferiority

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B08, B11, B12, B13  
**目标：** 实现配对 Bootstrap、McNemar、非劣 margin、失败策略和样本完整性检查。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B15
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B15-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-stats/src/paired.ts`
- `packages/benchmark-stats/src/bootstrap.ts`
- `packages/benchmark-stats/src/mcnemar.ts`
- `packages/benchmark-stats/test/paired.test.ts`
- `packages/benchmark-stats/test/golden-vectors.json`

此外只允许创建：

```text
artifacts/task-evidence/B15/red.txt
artifacts/task-evidence/B15/green.txt
artifacts/task-evidence/B15/negative.txt
artifacts/task-evidence/B15/full-gate.txt
artifacts/task-evidence/B15.json
```

## 3. 输入与输出合同

### Consumes

- Static/Reader/Continuation/Economics results
- BenchmarkConfig

### Produces

- computePairedStatistics()
- PairedMetricReport[]
- SampleIntegrityReport

### 必须实现的公开接口

```ts
export function computePairedStatistics(input: PairedStatisticsInput): PairedStatisticsReport;
export function pairedBootstrap(values: readonly PairedValue[], options: BootstrapOptions): BootstrapResult;
export function mcnemarTable(values: readonly PairedBoolean[]): McNemarTable;
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

在 `packages/benchmark-stats/test/paired.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("matches the normative Python bootstrap golden vector", () => {
  expect(pairedBootstrap(golden.input, golden.options)).toEqual(golden.expected);
});

it("fails sample integrity when one arm silently drops a timeout", () => {
  const report = computePairedStatistics(unbalancedPairFixture());
  expect(report.sampleIntegrity.ok).toBe(false);
  expect(report.sampleIntegrity.errors).toContainEqual(expect.stringMatching(/missing pair/));
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
const golden = {
  input: [{ key: "s1", baseline: 0, candidate: 1 }, { key: "s2", baseline: 1, candidate: 1 }],
  options: { samples: 1000, seed: 7, statistic: "mean" },
  expected: loadJson("test/golden-vectors.json").binaryExample,
};
function unbalancedPairFixture(): PairedStatisticsInput {
  return { metric: "task-success", baseline: [{ key: "s1", value: 1 }, { key: "s2", value: 0 }], candidate: [{ key: "s1", value: 1 }], failurePolicy: "count-arm-failure" };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B15
set -o pipefail
pnpm vitest run packages/benchmark-stats/test/paired.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B15/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-stats/src/paired.ts` 先写类型和最小实现。实现必须遵循：

1. Join key = scenarioId/boundaryId/replicate/seed/cacheMode。
2. 任何 Arm 缺失先按 failure policy 补失败或整体 infra exclude。
3. Bootstrap 对 pair index 重采样，固定 seed，默认 10k。
4. Binary success 输出 CI + McNemar discordant table。
5. Continuous 输出 paired median relative delta + CI。
6. W1 margin .03，W2 .02；配置可更严格不可在运行后放宽。

### Step 4 — 增加负例与故障测试

- [ ] golden Python parity
- [ ] all ties
- [ ] all failures
- [ ] small N warning
- [ ] unbalanced pairs
- [ ] infra exclusion all-arm
- [ ] NaN rejection
- [ ] deterministic seed

```bash
set -o pipefail
pnpm vitest run packages/benchmark-stats/test/paired.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B15/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-stats/test/paired.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B15/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B15/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B15.json` 必须记录：

```json
{
  "taskId": "B15",
  "allowedFiles": ["packages/benchmark-stats/src/paired.ts", "packages/benchmark-stats/src/bootstrap.ts", "packages/benchmark-stats/src/mcnemar.ts", "packages/benchmark-stats/test/paired.test.ts", "packages/benchmark-stats/test/golden-vectors.json"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B15/red.txt",
  "greenLog": "artifacts/task-evidence/B15/green.txt",
  "negativeLog": "artifacts/task-evidence/B15/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B15/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B15
python3 scripts/taskctl.py verify-evidence B15
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-stats/src/paired.ts packages/benchmark-stats/src/bootstrap.ts packages/benchmark-stats/src/mcnemar.ts packages/benchmark-stats/test/paired.test.ts packages/benchmark-stats/test/golden-vectors.json artifacts/task-evidence/B15
git commit -m "feat(b15): Paired Statistics and Non-inferiority"
python3 scripts/taskctl.py record-commit B15 HEAD
```

## 6. 完成验收

- [ ] 与 reference scorer golden 一致
- [ ] 原始 paired samples 可下载
- [ ] CI/margin/sample count 同时报告
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
