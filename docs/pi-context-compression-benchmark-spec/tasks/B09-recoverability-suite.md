# B09 — Recoverability Suite

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B04, B06  
**目标：** 证明被 W1 移出 Pi Context 的原始 Tool Result 可按 scope/handle/range 逐字恢复。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B09
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B09-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-scoring/src/recoverability.ts`
- `packages/benchmark-scoring/src/blob-faults.ts`
- `packages/benchmark-scoring/test/recoverability.test.ts`
- `packages/benchmark-scoring/test/fixtures/raw.bin`

此外只允许创建：

```text
artifacts/task-evidence/B09/red.txt
artifacts/task-evidence/B09/green.txt
artifacts/task-evidence/B09/negative.txt
artifacts/task-evidence/B09/full-gate.txt
artifacts/task-evidence/B09.json
```

## 3. 输入与输出合同

### Consumes

- RawEvidenceHandle
- Oracle recallable items
- encrypted CAS reader
- Saga receipts

### Produces

- scoreRecoverability()
- RecoverabilityReport
- BlobRecoveryRecord[]

### 必须实现的公开接口

```ts
export function scoreRecoverability(input: RecoverabilityInput): Promise<RecoverabilityReport>;
export interface RecoverabilityReport {
  exactRecoveryRate: number;
  rangeRecoveryRate: number;
  crossScopeLeaks: number;
  corruptionsDetected: number;
  records: readonly BlobRecoveryRecord[];
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

在 `packages/benchmark-scoring/test/recoverability.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("recovers exact bytes and verifies sha256", async () => {
  const report = await scoreRecoverability(recoveryFixture());
  expect(report.exactRecoveryRate).toBe(1);
  expect(report.records[0].observedSha256).toBe(report.records[0].expectedSha256);
});

it("rejects the same handle from another workspace", async () => {
  const report = await scoreRecoverability(crossScopeFixture());
  expect(report.crossScopeLeaks).toBe(0);
  expect(report.records[0].failureCode).toBe("SCOPE_DENIED");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function recoveryFixture(): RecoverabilityInput {
  const bytes = new TextEncoder().encode("full build output\nERROR 42\n");
  return {
    scope: { workspaceId: "w1", sessionId: "s1", branchId: "b1" },
    requests: [{ handle: "blob-1", expectedSha256: sha256Bytes(bytes), expectedLength: bytes.length }],
    store: inMemoryEncryptedStore([{ handle: "blob-1", scope: "w1/s1/b1", bytes }]),
  };
}
function crossScopeFixture(): RecoverabilityInput {
  return { ...recoveryFixture(), scope: { workspaceId: "w2", sessionId: "s1", branchId: "b1" } };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B09
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recoverability.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B09/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-scoring/src/recoverability.ts` 先写类型和最小实现。实现必须遵循：

1. 读取前验证 workspace/session/branch scope。
2. 完整读取比较 byte length + SHA-256；range 比较 exact slice。
3. 注入 corrupt/truncate/wrong-key/missing-index/prepared-only crash 状态。
4. 错误必须区分 not-found、scope-denied、integrity-failed、key-unavailable。
5. 任何泄漏或 silent corruption 是 Hard Gate。

### Step 4 — 增加负例与故障测试

- [ ] 0-byte/CJK/binary/large blob
- [ ] range boundary
- [ ] key rotation
- [ ] orphan prepared blob
- [ ] host committed receipt missing
- [ ] tamper detection
- [ ] cross workspace/session/branch
- [ ] cancellation

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recoverability.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B09/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-scoring/test/recoverability.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B09/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B09/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B09.json` 必须记录：

```json
{
  "taskId": "B09",
  "allowedFiles": ["packages/benchmark-scoring/src/recoverability.ts", "packages/benchmark-scoring/src/blob-faults.ts", "packages/benchmark-scoring/test/recoverability.test.ts", "packages/benchmark-scoring/test/fixtures/raw.bin"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B09/red.txt",
  "greenLog": "artifacts/task-evidence/B09/green.txt",
  "negativeLog": "artifacts/task-evidence/B09/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B09/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B09
python3 scripts/taskctl.py verify-evidence B09
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-scoring/src/recoverability.ts packages/benchmark-scoring/src/blob-faults.ts packages/benchmark-scoring/test/recoverability.test.ts packages/benchmark-scoring/test/fixtures/raw.bin artifacts/task-evidence/B09
git commit -m "feat(b09): Recoverability Suite"
python3 scripts/taskctl.py record-commit B09 HEAD
```

## 6. 完成验收

- [ ] Gate corpus exact recovery 100%
- [ ] 跨 scope 泄漏 0
- [ ] 损坏永不返回未验证内容
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
