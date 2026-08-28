# B03 — Boundary Snapshot and Restore

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B01, B02  
**目标：** 冻结 Pi Home、Session Tree、Workspace、Runtime Store 与环境元数据，使每个 Arm 从同一物理状态启动。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B03
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B03-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-harness/src/snapshot.ts`
- `packages/benchmark-harness/src/archive.ts`
- `packages/benchmark-harness/test/snapshot.test.ts`
- `packages/benchmark-harness/test/fixtures/workspace/.keep`

此外只允许创建：

```text
artifacts/task-evidence/B03/red.txt
artifacts/task-evidence/B03/green.txt
artifacts/task-evidence/B03/negative.txt
artifacts/task-evidence/B03/full-gate.txt
artifacts/task-evidence/B03.json
```

## 3. 输入与输出合同

### Consumes

- RawTrace
- BoundarySnapshot schema
- filesystem/process abstractions

### Produces

- createBoundarySnapshot()
- restoreBoundarySnapshot()
- verifyBoundarySnapshot()

### 必须实现的公开接口

```ts
export interface SnapshotSource {
  piHome: string;
  workspace: string;
  runtimeStore?: string;
  sessionFile: string;
  branchLeafId: string;
  environmentAllowlist: readonly string[];
}
export function createBoundarySnapshot(source: SnapshotSource, outDir: string): Promise<BoundarySnapshot>;
export function restoreBoundarySnapshot(snapshot: BoundarySnapshot, target: RestoreTarget): Promise<RestoreReceipt>;
export function verifyBoundarySnapshot(snapshot: BoundarySnapshot): Promise<void>;
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

在 `packages/benchmark-harness/test/snapshot.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("restores identical file hashes and current branch leaf", async () => {
  const snapshot = await createBoundarySnapshot(sourceFixture(), tmp("snap"));
  const receipt = await restoreBoundarySnapshot(snapshot, targetFixture());
  expect(receipt.workspaceSha256).toBe(snapshot.workspaceSnapshotSha256);
  expect(receipt.branchLeafId).toBe(snapshot.boundary.leafId);
});

it("refuses a target directory that is not empty", async () => {
  await expect(restoreBoundarySnapshot(snapshotFixture(), nonEmptyTarget()))
    .rejects.toThrow(/empty/);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function sourceFixture(): SnapshotSource {
  return {
    piHome: fixturePath("pi-home"), workspace: fixturePath("workspace"),
    runtimeStore: fixturePath("runtime"), sessionFile: fixturePath("session.jsonl"),
    branchLeafId: "leaf-0001", environmentAllowlist: ["LANG", "TZ"],
  };
}
function targetFixture(): RestoreTarget {
  return { piHome: tmp("pi"), workspace: tmp("ws"), runtimeStore: tmp("rt") };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B03
set -o pipefail
pnpm vitest run packages/benchmark-harness/test/snapshot.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B03/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-harness/src/snapshot.ts` 先写类型和最小实现。实现必须遵循：

1. 逻辑归档按 path 排序，标准化 mtime/uid/gid 后计算 hash。
2. 排除 node_modules/cache/build outputs 只能由 scenario manifest 明确声明。
3. Snapshot 不包含 Provider credentials；运行时从 secret manager 注入。
4. Restore 只写新空目录，全部校验后原子 rename 为 active。
5. 记录 Git HEAD/index/worktree diff、进程/端口 fixture 和外部 side-effect simulator state。

### Step 4 — 增加负例与故障测试

- [ ] symlink escape 拒绝
- [ ] 权限位保存
- [ ] 路径遍历拒绝
- [ ] 损坏 archive 拒绝
- [ ] restore 两个 Arm 到不同目录互不污染
- [ ] Session parent/leaf tree 一致

```bash
set -o pipefail
pnpm vitest run packages/benchmark-harness/test/snapshot.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B03/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-harness/test/snapshot.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B03/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B03/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B03.json` 必须记录：

```json
{
  "taskId": "B03",
  "allowedFiles": ["packages/benchmark-harness/src/snapshot.ts", "packages/benchmark-harness/src/archive.ts", "packages/benchmark-harness/test/snapshot.test.ts", "packages/benchmark-harness/test/fixtures/workspace/.keep"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B03/red.txt",
  "greenLog": "artifacts/task-evidence/B03/green.txt",
  "negativeLog": "artifacts/task-evidence/B03/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B03/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B03
python3 scripts/taskctl.py verify-evidence B03
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-harness/src/snapshot.ts packages/benchmark-harness/src/archive.ts packages/benchmark-harness/test/snapshot.test.ts packages/benchmark-harness/test/fixtures/workspace/.keep artifacts/task-evidence/B03
git commit -m "feat(b03): Boundary Snapshot and Restore"
python3 scripts/taskctl.py record-commit B03 HEAD
```

## 6. 完成验收

- [ ] clean restore 后所有 manifest hash 一致
- [ ] 任一字节损坏导致 fail closed
- [ ] Arm run 不共享可写目录
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
