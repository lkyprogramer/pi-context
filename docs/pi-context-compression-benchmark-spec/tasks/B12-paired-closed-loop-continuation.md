# B12 — Paired Closed-loop Continuation

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B03, B05, B06  
**目标：** 从同一 BoundarySnapshot 为各 Arm 运行相同隐藏后续任务，用环境断言评估真实行为。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B12
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B12-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-continuation/src/runner.ts`
- `packages/benchmark-continuation/src/assertions.ts`
- `packages/benchmark-continuation/src/sandbox.ts`
- `packages/benchmark-continuation/test/runner.test.ts`
- `packages/benchmark-continuation/test/assertions.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B12/red.txt
artifacts/task-evidence/B12/green.txt
artifacts/task-evidence/B12/negative.txt
artifacts/task-evidence/B12/full-gate.txt
artifacts/task-evidence/B12.json
```

## 3. 输入与输出合同

### Consumes

- BoundarySnapshot
- Arm Artifact
- ContinuationScenario
- Oracle environment assertions
- ExecutorProvider

### Produces

- runPairedContinuation()
- ContinuationResult[]
- ActionTrace

### 必须实现的公开接口

```ts
export function runPairedContinuation(input: PairedContinuationInput): Promise<PairedContinuationResult>;
export function evaluateEnvironmentAssertions(input: AssertionEvaluationInput): Promise<EnvironmentAssertionResult[]>;
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

在 `packages/benchmark-continuation/test/runner.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("restores a fresh workspace for every arm and replicate", async () => {
  const result = await runPairedContinuation(continuationFixture());
  expect(new Set(result.runs.map(r => r.workspacePath)).size).toBe(result.runs.length);
  expect(result.runs.every(r => r.initialWorkspaceHash === result.snapshot.workspaceSnapshotSha256)).toBe(true);
});

it("marks a forbidden deploy command as failure even when the final text claims success", async () => {
  const result = await runPairedContinuation(forbiddenActionFixture());
  expect(result.runs[0].success).toBe(false);
  expect(result.runs[0].forbiddenActions).toBe(1);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function continuationFixture(): PairedContinuationInput {
  return {
    snapshot: snapshot("deploy-constraint"), arms: [artifactA0(), artifactA2()],
    scenario: { scenarioId: "deploy-constraint", hiddenTaskRef: "sealed://task-1", maxTurns: 8, timeoutMs: 300_000 },
    executor: recordedExecutor("deploy-continuation.jsonl"), replicates: 3, seeds: [11, 12, 13],
    assertions: [{ id: "a1", kind: "forbidden-command-not-executed", pattern: "deploy" }],
  };
}
const forbiddenActionFixture = continuationFixture;
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B12
set -o pipefail
pnpm vitest run packages/benchmark-continuation/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B12/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-continuation/src/runner.ts` 先写类型和最小实现。实现必须遵循：

1. 每个 Arm/replicate restore 到独立沙箱。
2. 注入相同 sealed hidden task；压缩器从未读取该 task。
3. 固定 Executor model/temperature/seed/thinking/tool set/turn limit。
4. 记录所有 messages/tool calls/results/files/processes/network simulator actions。
5. 先跑禁止动作实时 guard，再跑终态环境断言。
6. 失败分类为 compressor/retriever/reader/executor/infrastructure。

### Step 4 — 增加负例与故障测试

- [ ] 成功/失败测试
- [ ] 文件 hash
- [ ] git diff
- [ ] 禁止命令
- [ ] 重复 tool call
- [ ] blocked action
- [ ] timeout
- [ ] process side effect
- [ ] branch external state
- [ ] Provider failure pair rerun

```bash
set -o pipefail
pnpm vitest run packages/benchmark-continuation/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B12/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-continuation/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B12/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B12/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B12.json` 必须记录：

```json
{
  "taskId": "B12",
  "allowedFiles": ["packages/benchmark-continuation/src/runner.ts", "packages/benchmark-continuation/src/assertions.ts", "packages/benchmark-continuation/src/sandbox.ts", "packages/benchmark-continuation/test/runner.test.ts", "packages/benchmark-continuation/test/assertions.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B12/red.txt",
  "greenLog": "artifacts/task-evidence/B12/green.txt",
  "negativeLog": "artifacts/task-evidence/B12/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B12/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B12
python3 scripts/taskctl.py verify-evidence B12
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-continuation/src/runner.ts packages/benchmark-continuation/src/assertions.ts packages/benchmark-continuation/src/sandbox.ts packages/benchmark-continuation/test/runner.test.ts packages/benchmark-continuation/test/assertions.test.ts artifacts/task-evidence/B12
git commit -m "feat(b12): Paired Closed-loop Continuation"
python3 scripts/taskctl.py record-commit B12 HEAD
```

## 6. 完成验收

- [ ] 同 pair 初始 hash 一致
- [ ] 失败不从分母删除
- [ ] 环境断言而非 final prose 决定 success
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
