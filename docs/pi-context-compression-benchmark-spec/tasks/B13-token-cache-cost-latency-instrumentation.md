# B13 — Token Cache Cost Latency Instrumentation

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B05, B06, B07  
**目标：** 统一采集输入/输出/cache/费用、Hook 各阶段延迟和宿主 full-history clone 成本。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B13
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B13-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-metrics/src/economics.ts`
- `packages/benchmark-metrics/src/timing.ts`
- `packages/benchmark-metrics/src/pricing.ts`
- `packages/benchmark-metrics/test/economics.test.ts`
- `packages/benchmark-metrics/test/pricing.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B13/red.txt
artifacts/task-evidence/B13/green.txt
artifacts/task-evidence/B13/negative.txt
artifacts/task-evidence/B13/full-gate.txt
artifacts/task-evidence/B13.json
```

## 3. 输入与输出合同

### Consumes

- Provider usage
- Arm phase spans
- versioned price snapshot
- Continuation results

### Produces

- measureEconomics()
- CostMetrics
- RealizedNetRecord

### 必须实现的公开接口

```ts
export function measureEconomics(input: EconomicsInput): EconomicsReport;
export function computeRealizedNet(input: RealizedNetInput): number;
export function loadPriceSnapshot(value: unknown): PriceSnapshot;
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

在 `packages/benchmark-metrics/test/economics.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("uses cache read/write prices separately", () => {
  const r = measureEconomics(costFixture({ input: 100, cacheRead: 1000, cacheWrite: 200 }));
  expect(r.providerCost).toBeCloseTo(expectedSeparateBucketCost);
});

it("does not allow token savings to offset a quality failure", () => {
  expect(() => computeRealizedNet({ ...netFixture(), qualityGatePassed: false }))
    .toThrow(/quality gate/);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
const price = { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 };
const expectedSeparateBucketCost = (100 * 2 + 1000 * 0.2 + 200 * 2.5) / 1_000_000;
function costFixture(usage: Partial<ProviderUsage>): EconomicsInput {
  return { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...usage }, price, spans: [], qualityGatePassed: true };
}
function netFixture(): RealizedNetInput {
  return { qualityGatePassed: true, avoidedInputCost: 1, avoidedOverflowCost: 0, summaryCost: 0.2, cacheRewriteCost: 0.1, recallCost: 0.1, backgroundWasteCost: 0, configuredLatencyCost: 0 };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B13
set -o pipefail
pnpm vitest run packages/benchmark-metrics/test/economics.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B13/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-metrics/src/economics.ts` 先写类型和最小实现。实现必须遵循：

1. 优先使用 Provider usage，估算值单独标 estimated。
2. 记录 Pi pre-context structuredClone、PCR hook、CAS、Reducer、FTS、Compaction、Provider 首字节和总时延。
3. 价格由版本化 snapshot 提供，不读实时网页。
4. Cost/success 把失败 run 成本计入分母和总成本。
5. Realized Net 只在质量 Hard Gate 通过后计算。

### Step 4 — 增加负例与故障测试

- [ ] cache on/off
- [ ] missing usage
- [ ] negative/NaN price
- [ ] stale price snapshot
- [ ] failed run cost
- [ ] P50/P95/P99
- [ ] long session clone scaling
- [ ] background stale work

```bash
set -o pipefail
pnpm vitest run packages/benchmark-metrics/test/economics.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B13/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-metrics/test/economics.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B13/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B13/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B13.json` 必须记录：

```json
{
  "taskId": "B13",
  "allowedFiles": ["packages/benchmark-metrics/src/economics.ts", "packages/benchmark-metrics/src/timing.ts", "packages/benchmark-metrics/src/pricing.ts", "packages/benchmark-metrics/test/economics.test.ts", "packages/benchmark-metrics/test/pricing.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B13/red.txt",
  "greenLog": "artifacts/task-evidence/B13/green.txt",
  "negativeLog": "artifacts/task-evidence/B13/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B13/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B13
python3 scripts/taskctl.py verify-evidence B13
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-metrics/src/economics.ts packages/benchmark-metrics/src/timing.ts packages/benchmark-metrics/src/pricing.ts packages/benchmark-metrics/test/economics.test.ts packages/benchmark-metrics/test/pricing.test.ts artifacts/task-evidence/B13
git commit -m "feat(b13): Token Cache Cost Latency Instrumentation"
python3 scripts/taskctl.py record-commit B13 HEAD
```

## 6. 完成验收

- [ ] 费用可从原始 usage+price snapshot 重算
- [ ] 每个 latency span 有 monotonic clock
- [ ] estimated 与 measured 不混合
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
