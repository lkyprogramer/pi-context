# B08 — Static Artifact Scoring

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B04, B05  
**目标：** 以完全确定性算法计算结构、Oracle Coverage、极性/时间/状态、泄漏、Tool Pair 和压缩率。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B08
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B08-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-scoring/src/static.ts`
- `packages/benchmark-scoring/src/matchers.ts`
- `packages/benchmark-scoring/test/static.test.ts`
- `packages/benchmark-scoring/test/matchers.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B08/red.txt
artifacts/task-evidence/B08/green.txt
artifacts/task-evidence/B08/negative.txt
artifacts/task-evidence/B08/full-gate.txt
artifacts/task-evidence/B08.json
```

## 3. 输入与输出合同

### Consumes

- CompressionArtifact
- Oracle
- RawTrace
- normalizers

### Produces

- scoreStaticArtifact()
- StaticScore
- ItemMatchRecord[]

### 必须实现的公开接口

```ts
export function scoreStaticArtifact(input: {
  artifact: CompressionArtifact;
  trace: RawTrace;
  oracle: Oracle;
  tokenizer: TokenCounter;
}): StaticScoreResult;
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

在 `packages/benchmark-scoring/test/static.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("does not give credit when the entity appears with inverted polarity", () => {
  const result = scoreStaticArtifact(fixture("tests failed", "tests passed"));
  expect(result.score.polarityAccuracy).toBe(0);
  expect(result.matches[0].failureCode).toBe("POLARITY_MISMATCH");
});

it("detects an orphan tool result", () => {
  const result = scoreStaticArtifact(orphanResultFixture());
  expect(result.score.toolPairViolations).toBe(1);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function fixture(sourceText: string, artifactText: string): StaticScoringInput {
  return {
    trace: trace([{ entryId: "r1", role: "toolResult", text: sourceText }]),
    artifact: artifactWithText(artifactText),
    oracle: oracle([{ id: "o1", kind: "test-outcome", canonical: sourceText, polarity: sourceText.includes("failed") ? "is-not" : "is", status: "active", sourceRefs: ["r1"], visibility: "must-visible", risk: "high-risk-outcome" }]),
    tokenizer: charTokenCounter(),
  };
}
function orphanResultFixture(): StaticScoringInput {
  return { ...fixture("ok", "ok"), artifact: artifactWithMessages([{ role: "toolResult", toolCallId: "missing", toolName: "bash", content: [{ type: "text", text: "ok" }] }]) };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B08
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/static.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B08/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-scoring/src/static.ts` 先写类型和最小实现。实现必须遵循：

1. 将 Artifact 转成 Typed Visible Atoms，不对整段文本做 embedding 相似度。
2. 对 exact 类型使用 B04 normalizer。
3. 对结构化 PCR item 直接读取 typed field；Pi Summary 使用受限 extractor，只给可证明匹配计分。
4. must-omit 扫描 canonical/aliases/encoded variants。
5. Tool Pair 按 toolCallId 和消息顺序验证。
6. 每个 Item 产生逐条 MatchRecord，聚合指标可回溯。

### Step 4 — 增加负例与故障测试

- [ ] 极性反转
- [ ] 旧状态 stale
- [ ] 时间更新
- [ ] 同 basename
- [ ] secret base64/hex fragments
- [ ] latest user not last
- [ ] 重复 user
- [ ] null denominator
- [ ] deterministic score

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/static.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B08/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/static.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B08/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B08/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B08.json` 必须记录：

```json
{
  "taskId": "B08",
  "allowedFiles": ["packages/benchmark-scoring/src/static.ts", "packages/benchmark-scoring/src/matchers.ts", "packages/benchmark-scoring/test/static.test.ts", "packages/benchmark-scoring/test/matchers.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B08/red.txt",
  "greenLog": "artifacts/task-evidence/B08/green.txt",
  "negativeLog": "artifacts/task-evidence/B08/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B08/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B08
python3 scripts/taskctl.py verify-evidence B08
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-scoring/src/static.ts packages/benchmark-scoring/src/matchers.ts packages/benchmark-scoring/test/static.test.ts packages/benchmark-scoring/test/matchers.test.ts artifacts/task-evidence/B08
git commit -m "feat(b08): Static Artifact Scoring"
python3 scripts/taskctl.py record-commit B08 HEAD
```

## 6. 完成验收

- [ ] 同 Artifact 重评结果 hash 一致
- [ ] 每个聚合值可追溯 ItemMatchRecord
- [ ] 不存在 ROUGE/BLEU/embedding Gate
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
