# B18 — PCR Integration and Release

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B17  
**目标：** 把 Benchmark Workstream 接入 PCR Roadmap，并验证 clean install、包完整性、SBOM 和 smoke replay。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B18
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B18-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `docs/pcr-integration.md`
- `docs/release-runbook.md`
- `scripts/validate-release.mjs`
- `scripts/build-release.mjs`
- `tests/release/package.test.ts`
- `tests/release/clean-install.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B18/red.txt
artifacts/task-evidence/B18/green.txt
artifacts/task-evidence/B18/negative.txt
artifacts/task-evidence/B18/full-gate.txt
artifacts/task-evidence/B18.json
```

## 3. 输入与输出合同

### Consumes

- Gate Engine
- 所有 package build artifacts
- PCR Task mapping

### Produces

- buildBenchmarkRelease()
- release manifest
- PCR integration patch
- installable tarball/zip

### 必须实现的公开接口

```ts
export function buildBenchmarkRelease(input: ReleaseBuildInput): Promise<ReleaseArtifact>;
export function validateReleaseArtifact(path: string): Promise<ReleaseValidationReport>;
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

在 `tests/release/package.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("installs into an empty directory and runs the CI profile", async () => {
  const artifact = await buildBenchmarkRelease(releaseFixture());
  const validation = await validateReleaseArtifact(artifact.path);
  expect(validation.cleanInstallPass).toBe(true);
  expect(validation.ciProfilePass).toBe(true);
});

it("rejects a release whose PCR integration still treats W1 as a compactor", async () => {
  await expect(validateReleaseArtifact(badRoadmapFixture())).resolves.toMatchObject({
    contractPass: false,
    errors: expect.arrayContaining([expect.stringMatching(/W1.*compactor/)]),
  });
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function releaseFixture(): ReleaseBuildInput {
  return {
    workspaceRoot: fixturePath("workspace"), outDir: tmp("release"), version: "0.1.0",
    sourceSnapshot: loadJson("SOURCE-SNAPSHOT.json"), requiredProfiles: ["ci"],
  };
}
function badRoadmapFixture(): string {
  return fixturePackage({ pcrRoadmapText: "W1 compactor replaces Pi native" });
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B18
set -o pipefail
pnpm vitest run tests/release/package.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B18/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `docs/pcr-integration.md` 先写类型和最小实现。实现必须遵循：

1. 构建所有 workspace packages。
2. 生成 npm pack dry-run 文件清单、license、SBOM、manifest。
3. 在空目录生产安装，只用 dependencies/peerDependencies。
4. 运行 reference scorer tests、artifact validator、CI profile smoke。
5. 生成 PCR docs/task overlay，旧 Benchmark 定义标 superseded。
6. 发布包含 exact source snapshot 和 compatibility matrix。

### Step 4 — 增加负例与故障测试

- [ ] clean npm/git-like install
- [ ] missing runtime dependency
- [ ] Node 22 Linux/macOS metadata
- [ ] manifest tamper
- [ ] broken local link
- [ ] PCR task map
- [ ] zip extract/revalidate

```bash
set -o pipefail
pnpm vitest run tests/release/package.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B18/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run tests/release/package.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B18/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B18/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B18.json` 必须记录：

```json
{
  "taskId": "B18",
  "allowedFiles": ["docs/pcr-integration.md", "docs/release-runbook.md", "scripts/validate-release.mjs", "scripts/build-release.mjs", "tests/release/package.test.ts", "tests/release/clean-install.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B18/red.txt",
  "greenLog": "artifacts/task-evidence/B18/green.txt",
  "negativeLog": "artifacts/task-evidence/B18/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B18/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B18
python3 scripts/taskctl.py verify-evidence B18
```

### Step 8 — 原子提交

```bash
git add docs/pcr-integration.md docs/release-runbook.md scripts/validate-release.mjs scripts/build-release.mjs tests/release/package.test.ts tests/release/clean-install.test.ts artifacts/task-evidence/B18
git commit -m "feat(b18): PCR Integration and Release"
python3 scripts/taskctl.py record-commit B18 HEAD
```

## 6. 完成验收

- [ ] release validator 全通过
- [ ] 安装包不依赖开发机绝对路径
- [ ] PCR W1/W2 Gate 引用本规格唯一合同
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
