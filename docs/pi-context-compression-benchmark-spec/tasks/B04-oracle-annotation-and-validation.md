# B04 — Oracle Annotation and Validation

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B01, B02  
**目标：** 建立可机器评分的 Claim/Directive/Outcome/Secret/Environment Oracle，并验证 source closure。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B04
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B04-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-oracle/src/oracle.ts`
- `packages/benchmark-oracle/src/normalizers.ts`
- `packages/benchmark-oracle/test/oracle.test.ts`
- `packages/benchmark-oracle/test/normalizers.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B04/red.txt
artifacts/task-evidence/B04/green.txt
artifacts/task-evidence/B04/negative.txt
artifacts/task-evidence/B04/full-gate.txt
artifacts/task-evidence/B04.json
```

## 3. 输入与输出合同

### Consumes

- RawTrace
- Oracle schema
- 28-reference-algorithms-and-formulas.md

### Produces

- validateOracle()
- normalizeOracleValue()
- OracleValidationReport

### 必须实现的公开接口

```ts
export function validateOracle(oracle: Oracle, trace: RawTrace): OracleValidationReport;
export function normalizeOracleValue(kind: OracleItemKind, value: unknown): NormalizedValue;
export interface OracleValidationReport {
  ok: boolean;
  errors: readonly OracleValidationError[];
  resolvedSourceHashes: Readonly<Record<string, string>>;
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

在 `packages/benchmark-oracle/test/oracle.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("rejects a must-not constraint whose quote is not in its source", () => {
  const report = validateOracle(oracleWithInventedQuote(), rawTraceFixture());
  expect(report.ok).toBe(false);
  expect(report.errors.map(e => e.code)).toContain("SOURCE_QUOTE_MISMATCH");
});

it("requires tool evidence for a high-risk test-passed outcome", () => {
  const report = validateOracle(assistantOnlyPassedClaim(), rawTraceFixture());
  expect(report.errors.map(e => e.code)).toContain("OUTCOME_NOT_ATTESTED");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function rawTraceFixture(): RawTrace {
  return parseRawTrace({
    traceId: "t1", scenarioId: "s1", seed: 1,
    entries: [
      { entryId: "u1", role: "user", text: "Do not deploy until tests pass", contentSha256: sha256("Do not deploy until tests pass") },
      { entryId: "a1", role: "assistant", text: "Tests passed", contentSha256: sha256("Tests passed") },
      { entryId: "r1", role: "toolResult", text: "exit 1", toolName: "test", toolCallId: "c1", contentSha256: sha256("exit 1") },
    ],
  });
}
function oracleWithInventedQuote(): Oracle {
  return { ...baseOracle(), items: [{ ...baseConstraint(), quote: "Deploy is allowed", sourceRefs: ["u1"] }] };
}
function assistantOnlyPassedClaim(): Oracle {
  return { ...baseOracle(), items: [{ ...baseOutcome(), canonical: "tests passed", sourceRefs: ["a1"], risk: "high-risk-outcome" }] };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B04
set -o pipefail
pnpm vitest run packages/benchmark-oracle/test/oracle.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B04/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-oracle/src/oracle.ts` 先写类型和最小实现。实现必须遵循：

1. 每个 sourceRef 必须存在且 source hash 匹配。
2. Hard Directive exact quote/byte range 必须包含于 authenticated user source。
3. Outcome 的 authority 必须来自匹配 tool result/receipt，不能来自 assistant prose。
4. Supersession graph 必须无环，active key 不得有两个未标 contested 的冲突值。
5. must-omit item 不得出现在 Probe expected answer 中。

### Step 4 — 增加负例与故障测试

- [ ] must/must-not 极性
- [ ] 时间区间边界
- [ ] supersession cycle
- [ ] 同 basename path collision
- [ ] secret variant aliases
- [ ] unknown/abstention
- [ ] 跨 session sourceRef 拒绝

```bash
set -o pipefail
pnpm vitest run packages/benchmark-oracle/test/oracle.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B04/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-oracle/test/oracle.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B04/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B04/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B04.json` 必须记录：

```json
{
  "taskId": "B04",
  "allowedFiles": ["packages/benchmark-oracle/src/oracle.ts", "packages/benchmark-oracle/src/normalizers.ts", "packages/benchmark-oracle/test/oracle.test.ts", "packages/benchmark-oracle/test/normalizers.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B04/red.txt",
  "greenLog": "artifacts/task-evidence/B04/green.txt",
  "negativeLog": "artifacts/task-evidence/B04/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B04/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B04
python3 scripts/taskctl.py verify-evidence B04
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-oracle/src/oracle.ts packages/benchmark-oracle/src/normalizers.ts packages/benchmark-oracle/test/oracle.test.ts packages/benchmark-oracle/test/normalizers.test.ts artifacts/task-evidence/B04
git commit -m "feat(b04): Oracle Annotation and Validation"
python3 scripts/taskctl.py record-commit B04 HEAD
```

## 6. 完成验收

- [ ] 所有 corpus Oracle 在冻结前通过 source closure
- [ ] Validator 错误码稳定并进入报告
- [ ] Normalizer 不把不同绝对路径合并
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
