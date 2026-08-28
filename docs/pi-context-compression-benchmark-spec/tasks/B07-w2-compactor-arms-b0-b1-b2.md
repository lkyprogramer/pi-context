# B07 — W2 Compactor Arms B0/B1/B2

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B05, B06  
**目标：** 在相同 W1ShapedTrace、source span、retained tail 和目标预算下运行 Pi Native 与 PCR deterministic compactor/materializer。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B07
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B07-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-arms/src/w2.ts`
- `packages/benchmark-arms/src/budget-match.ts`
- `packages/benchmark-arms/test/w2.test.ts`
- `packages/benchmark-arms/test/fixtures/w1-shaped.json`

此外只允许创建：

```text
artifacts/task-evidence/B07/red.txt
artifacts/task-evidence/B07/green.txt
artifacts/task-evidence/B07/negative.txt
artifacts/task-evidence/B07/full-gate.txt
artifacts/task-evidence/B07.json
```

## 3. 输入与输出合同

### Consumes

- W1ShapedTrace
- PCR deterministic compactor/materializer public API
- runPiNativeArm

### Produces

- runW2CompactorArm()
- BudgetMatchReport
- B0/B1/B2 CompressionArtifact

### 必须实现的公开接口

```ts
export type W2ArmId = "B0" | "B1" | "B2";
export function runW2CompactorArm(input: W2ArmRunInput): Promise<ArmRunResult>;
export function verifyBudgetMatch(baseline: CompressionArtifact, candidate: CompressionArtifact, toleranceRatio?: number): BudgetMatchReport;
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

在 `packages/benchmark-arms/test/w2.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("uses the identical source span and retained-tail boundary for B0 and B1", async () => {
  const [b0, b1] = await runPair(w2Fixture());
  expect(b1.artifact.sourceSpan).toEqual(b0.artifact.sourceSpan);
  expect(b1.artifact.retainedTailStartId).toBe(b0.artifact.retainedTailStartId);
});

it("marks artifact-only efficiency invalid when budget differs by more than five percent", () => {
  expect(verifyBudgetMatch(artifact(10_000), artifact(11_000), 0.05).comparable).toBe(false);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function w2Fixture(): W2ComparisonInput {
  return {
    trace: w1ShapedTrace("same-input-hash"), snapshot: snapshot("s1"),
    sourceSpan: { firstEntryId: "u1", lastEntryId: "r20" }, retainedTailStartId: "u21",
    budget: { effectiveInputTokens: 64_000, targetVisibleTokens: 16_000, toleranceRatio: 0.05 },
    arms: [armB0(), armB1(), armB2()], provider: recordedProvider("w2.jsonl"),
  };
}
function artifact(tokens: number): CompressionArtifact {
  return { ...artifactBase(), visibleTokens: tokens };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B07
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w2.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B07/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-arms/src/w2.ts` 先写类型和最小实现。实现必须遵循：

1. 先运行共享 cut planner 或从冻结 preparation 提取 source span/retained tail。
2. B0 运行 Pi Native；B1 运行 PCR deterministic checkpoint 且 materializer identity；B2 启用完整 deterministic materializer。
3. 记录目标预算、实际 visible tokens 和 mismatch reason。
4. PCR 输出重复三次检查 outputHash stability。
5. 关闭 proactive recall 做 compactor-only；另有 end-to-end profile 启用。

### Step 4 — 增加负例与故障测试

- [ ] budget ±5%
- [ ] single huge turn
- [ ] tool pair
- [ ] empty compactable prefix
- [ ] oversize directive
- [ ] deterministic rerun
- [ ] Pi summary non-determinism recorded not hidden

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w2.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B07/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w2.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B07/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B07/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B07.json` 必须记录：

```json
{
  "taskId": "B07",
  "allowedFiles": ["packages/benchmark-arms/src/w2.ts", "packages/benchmark-arms/src/budget-match.ts", "packages/benchmark-arms/test/w2.test.ts", "packages/benchmark-arms/test/fixtures/w1-shaped.json"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B07/red.txt",
  "greenLog": "artifacts/task-evidence/B07/green.txt",
  "negativeLog": "artifacts/task-evidence/B07/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B07/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B07
python3 scripts/taskctl.py verify-evidence B07
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-arms/src/w2.ts packages/benchmark-arms/src/budget-match.ts packages/benchmark-arms/test/w2.test.ts packages/benchmark-arms/test/fixtures/w1-shaped.json artifacts/task-evidence/B07
git commit -m "feat(b07): W2 Compactor Arms B0/B1/B2"
python3 scripts/taskctl.py record-commit B07 HEAD
```

## 6. 完成验收

- [ ] B0/B1 source span/retained tail 完全一致
- [ ] 不可比预算不进入 artifact efficiency
- [ ] B2 与 B1 的增量可单独归因 materializer
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
