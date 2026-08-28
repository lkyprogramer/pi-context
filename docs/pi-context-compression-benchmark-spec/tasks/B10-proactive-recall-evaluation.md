# B10 — Proactive Recall Evaluation

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B04, B06  
**目标：** 分别测量需要召回时的命中和不需要召回时的沉默，证明主动召回的正增量。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B10
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B10-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-scoring/src/recall.ts`
- `packages/benchmark-scoring/src/ranking.ts`
- `packages/benchmark-scoring/test/recall.test.ts`
- `packages/benchmark-scoring/test/fixtures/queries.json`

此外只允许创建：

```text
artifacts/task-evidence/B10/red.txt
artifacts/task-evidence/B10/green.txt
artifacts/task-evidence/B10/negative.txt
artifacts/task-evidence/B10/full-gate.txt
artifacts/task-evidence/B10.json
```

## 3. 输入与输出合同

### Consumes

- RecallQuery
- ranked evidence hits
- Oracle relevant item IDs
- A1/A2 continuation outcomes

### Produces

- scoreProactiveRecall()
- RecallEval
- RecallDecisionRecord[]

### 必须实现的公开接口

```ts
export function scoreProactiveRecall(input: RecallEvaluationInput): RecallEvaluationResult;
export function computeRankingMetrics(relevant: ReadonlySet<string>, ranked: readonly string[], k: number): RankingMetrics;
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

在 `packages/benchmark-scoring/test/recall.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("computes recall@5 and mrr from oracle item ids", () => {
  const m = computeRankingMetrics(new Set(["e2", "e4"]), ["e9", "e2", "e4"], 5);
  expect(m.recallAtK).toBe(1);
  expect(m.mrr).toBe(0.5);
});

it("penalizes injection on recall-not-needed turns", () => {
  const result = scoreProactiveRecall(notNeededButInjectedFixture());
  expect(result.silenceRate).toBe(0);
  expect(result.falseInjectionRate).toBe(1);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function notNeededButInjectedFixture(): RecallEvaluationInput {
  return {
    scenarioId: "new-task", armId: "A2",
    queries: [{ queryId: "q1", needed: false, relevantItemIds: [], rankedItemIds: ["old-1"], injectedItemIds: ["old-1"], injectedTokens: 120 }],
    baselineTaskSuccess: true, candidateTaskSuccess: true,
  };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B10
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recall.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B10/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-scoring/src/recall.ts` 先写类型和最小实现。实现必须遵循：

1. Oracle 明确 needed true/false 和 relevant IDs。
2. needed：计算 Recall@k/MRR/nDCG/page precision。
3. not-needed：计算 silence/false injection。
4. 跨 turn 计算 repeated injection 和 token-turns。
5. A2 vs A1 在相同 hidden task 上比较 success delta，检索指标不能替代行为收益。

### Step 4 — 增加负例与故障测试

- [ ] 无 relevant item
- [ ] 多个 relevant
- [ ] 过期/冲突 hit
- [ ] 同证据重复
- [ ] 低置信只注入 pointer
- [ ] secret hit suppressed
- [ ] CJK/literal/FTS
- [ ] needed query 未触发

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recall.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B10/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recall.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B10/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B10/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B10.json` 必须记录：

```json
{
  "taskId": "B10",
  "allowedFiles": ["packages/benchmark-scoring/src/recall.ts", "packages/benchmark-scoring/src/ranking.ts", "packages/benchmark-scoring/test/recall.test.ts", "packages/benchmark-scoring/test/fixtures/queries.json"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B10/red.txt",
  "greenLog": "artifacts/task-evidence/B10/green.txt",
  "negativeLog": "artifacts/task-evidence/B10/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B10/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B10
python3 scripts/taskctl.py verify-evidence B10
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-scoring/src/recall.ts packages/benchmark-scoring/src/ranking.ts packages/benchmark-scoring/test/recall.test.ts packages/benchmark-scoring/test/fixtures/queries.json artifacts/task-evidence/B10
git commit -m "feat(b10): Proactive Recall Evaluation"
python3 scripts/taskctl.py record-commit B10 HEAD
```

## 6. 完成验收

- [ ] needed/not-needed 分开报告
- [ ] 所有 Query 留 DecisionRecord
- [ ] Gate 不删除未触发 Recall 的样本
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
