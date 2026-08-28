# B11 — Reader-isolated Probe Runner

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B04, B08  
**目标：** 固定 Reader 只读 Artifact 回答 Probe，并用 Full-context Ceiling 排除 Reader 本身不会的问题。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B11
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B11-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-reader/src/runner.ts`
- `packages/benchmark-reader/src/prompt.ts`
- `packages/benchmark-reader/test/runner.test.ts`
- `packages/benchmark-reader/test/fixtures/responses.jsonl`

此外只允许创建：

```text
artifacts/task-evidence/B11/red.txt
artifacts/task-evidence/B11/green.txt
artifacts/task-evidence/B11/negative.txt
artifacts/task-evidence/B11/full-gate.txt
artifacts/task-evidence/B11.json
```

## 3. 输入与输出合同

### Consumes

- CompressionArtifact
- ProbeSuite
- Oracle
- ReaderProvider

### Produces

- runReaderProbes()
- ProbeResult[]
- ReaderEvaluationReport

### 必须实现的公开接口

```ts
export function runReaderProbes(input: ReaderRunInput): Promise<ReaderEvaluationReport>;
export interface ReaderProvider {
  id: string;
  complete(request: ReaderRequest, signal?: AbortSignal): Promise<ReaderResponse>;
}
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

在 `packages/benchmark-reader/test/runner.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("does not expose the oracle expected answer to the reader", async () => {
  const provider = recordingReader();
  await runReaderProbes(readerFixture(provider));
  expect(provider.requests[0].serialized).not.toContain("expected");
});

it("excludes a probe from compressor loss when full context is wrong", async () => {
  const report = await runReaderProbes(ceilingFailureFixture());
  expect(report.eligibleProbeIds).not.toContain("p-hard");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function readerFixture(provider: ReaderProvider): ReaderRunInput {
  return {
    artifact: artifactWithText("Do not deploy; tests failed."),
    fullContext: fullContextWithSameFacts(),
    probes: [{ probeId: "p1", kind: "polarity", question: "May deployment proceed?", expected: "no", sourceItemIds: ["c1", "o1"], allowAbstain: false }],
    oracle: oracleForDeployConstraint(), provider,
    settings: { temperature: 0, maxOutputTokens: 256, seed: 7 },
  };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B11
set -o pipefail
pnpm vitest run packages/benchmark-reader/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B11/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-reader/src/runner.ts` 先写类型和最小实现。实现必须遵循：

1. 先跑 Full-context Ceiling，再跑每个 Artifact。
2. Reader request 只含固定 rubric、Artifact、Question，不含 Oracle expected。
3. 输出强制 JSON answer/abstain/evidenceRefs/confidence。
4. 结构化答案 deterministic score；开放解释另交 B14。
5. Gate profile 至少两个不同模型族，结果按 Reader 分开报告。

### Step 4 — 增加负例与故障测试

- [ ] exact/polarity/time/update/multi-hop/abstain
- [ ] malformed JSON retry一次
- [ ] timeout
- [ ] same-model self-judge 标记
- [ ] evidence ref hallucination
- [ ] full-context over-window exclusion

```bash
set -o pipefail
pnpm vitest run packages/benchmark-reader/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B11/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-reader/test/runner.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B11/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B11/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B11.json` 必须记录：

```json
{
  "taskId": "B11",
  "allowedFiles": ["packages/benchmark-reader/src/runner.ts", "packages/benchmark-reader/src/prompt.ts", "packages/benchmark-reader/test/runner.test.ts", "packages/benchmark-reader/test/fixtures/responses.jsonl"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B11/red.txt",
  "greenLog": "artifacts/task-evidence/B11/green.txt",
  "negativeLog": "artifacts/task-evidence/B11/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B11/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B11
python3 scripts/taskctl.py verify-evidence B11
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-reader/src/runner.ts packages/benchmark-reader/src/prompt.ts packages/benchmark-reader/test/runner.test.ts packages/benchmark-reader/test/fixtures/responses.jsonl artifacts/task-evidence/B11
git commit -m "feat(b11): Reader-isolated Probe Runner"
python3 scripts/taskctl.py record-commit B11 HEAD
```

## 6. 完成验收

- [ ] Reader Ceiling 和 eligible probes 显式记录
- [ ] Reader 无工具/RawTrace/Workspace 访问
- [ ] 原始 request/response 哈希留存
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
