# B14 — Blind LLM Judge

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B04, B08  
**目标：** 提供受限盲评，评估因果连续性与可执行性，同时保留 deterministic veto。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B14
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B14-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-judge/src/judge.ts`
- `packages/benchmark-judge/src/blinding.ts`
- `packages/benchmark-judge/src/rubric.ts`
- `packages/benchmark-judge/test/judge.test.ts`
- `packages/benchmark-judge/test/fixtures/ratings.json`

此外只允许创建：

```text
artifacts/task-evidence/B14/red.txt
artifacts/task-evidence/B14/green.txt
artifacts/task-evidence/B14/negative.txt
artifacts/task-evidence/B14/full-gate.txt
artifacts/task-evidence/B14.json
```

## 3. 输入与输出合同

### Consumes

- 匿名 Artifact X/Y
- 受限 Source Evidence
- JudgeProvider
- StaticScore vetoes

### Produces

- runBlindJudge()
- LlmJudgeRecord[]
- JudgeAgreementReport

### 必须实现的公开接口

```ts
export function runBlindJudge(input: BlindJudgeInput): Promise<BlindJudgeResult>;
export function blindArtifacts(a: CompressionArtifact, b: CompressionArtifact, seed: number): BlindedPair;
export function computeJudgeAgreement(records: readonly LlmJudgeRecord[]): JudgeAgreementReport;
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

在 `packages/benchmark-judge/test/judge.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("removes arm identity, costs and implementation names", () => {
  const pair = blindArtifacts(artifact("Pi Native"), artifact("PCR"), 7);
  expect(JSON.stringify(pair)).not.toMatch(/Pi Native|PCR|tokenCost/);
});

it("cannot prefer an artifact that has a deterministic hard veto", async () => {
  const result = await runBlindJudge(vetoFixture());
  expect(result.effectivePreference).toBe("X");
  expect(result.rawRecords[0].preference).toBe("Y");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function artifact(label: string): CompressionArtifact {
  return { ...artifactBase(), metadata: { implementationLabel: label, tokenCost: 123 } };
}
function vetoFixture(): BlindJudgeInput {
  return {
    artifactA: artifactWithText("Do not deploy"), artifactB: artifactWithText("Deployment completed"),
    sourceEvidence: [{ ref: "u1", text: "Do not deploy" }], judges: [recordedJudge({ preference: "Y" })],
    deterministicVetoes: [{ artifact: "B", code: "POLARITY_MISMATCH" }], seed: 7,
  };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B14
set -o pipefail
pnpm vitest run packages/benchmark-judge/test/judge.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B14/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-judge/src/judge.ts` 先写类型和最小实现。实现必须遵循：

1. 随机映射 X/Y 并保存 blinding seed。
2. Judge 看到受限 evidence excerpts，不看到 Arm/成本。
3. 要求 coverage/causalContinuity/actionability/unsupportedClaims/missingRefs。
4. 至少两个 Judge；same model as generator 不能是唯一 Judge。
5. 输出原始 preference 和 deterministic-veto 后 effective preference。

### Step 4 — 增加负例与故障测试

- [ ] 顺序偏差 A/B swap
- [ ] malformed response
- [ ] Judge disagreement
- [ ] self-judge tag
- [ ] fabricated evidence refs
- [ ] hard veto
- [ ] agreement calculation

```bash
set -o pipefail
pnpm vitest run packages/benchmark-judge/test/judge.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B14/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-judge/test/judge.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B14/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B14/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B14.json` 必须记录：

```json
{
  "taskId": "B14",
  "allowedFiles": ["packages/benchmark-judge/src/judge.ts", "packages/benchmark-judge/src/blinding.ts", "packages/benchmark-judge/src/rubric.ts", "packages/benchmark-judge/test/judge.test.ts", "packages/benchmark-judge/test/fixtures/ratings.json"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B14/red.txt",
  "greenLog": "artifacts/task-evidence/B14/green.txt",
  "negativeLog": "artifacts/task-evidence/B14/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B14/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B14
python3 scripts/taskctl.py verify-evidence B14
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-judge/src/judge.ts packages/benchmark-judge/src/blinding.ts packages/benchmark-judge/src/rubric.ts packages/benchmark-judge/test/judge.test.ts packages/benchmark-judge/test/fixtures/ratings.json artifacts/task-evidence/B14
git commit -m "feat(b14): Blind LLM Judge"
python3 scripts/taskctl.py record-commit B14 HEAD
```

## 6. 完成验收

- [ ] Judge 记录不可覆盖
- [ ] 盲化可验证
- [ ] 任何 Hard Gate 失败不被 Judge 翻转
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
