# B16 — Corpus and External Adapters

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B02, B03, B04  
**目标：** 构建版本化 Synthetic/Template/Real-redacted/External 语料，并隔离 public dev 与 sealed gate。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B16
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B16-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `benchmarks/corpus/manifest.json`
- `benchmarks/corpus/public/.gitkeep`
- `benchmarks/corpus/sealed/.gitkeep`
- `packages/benchmark-corpus/src/adapters.ts`
- `packages/benchmark-corpus/src/generator.ts`
- `packages/benchmark-corpus/test/adapters.test.ts`
- `packages/benchmark-corpus/test/generator.test.ts`

此外只允许创建：

```text
artifacts/task-evidence/B16/red.txt
artifacts/task-evidence/B16/green.txt
artifacts/task-evidence/B16/negative.txt
artifacts/task-evidence/B16/full-gate.txt
artifacts/task-evidence/B16.json
```

## 3. 输入与输出合同

### Consumes

- corpus/templates/*.scenario.json
- RawTrace/Snapshot/Oracle builders
- external dataset adapters

### Produces

- loadBenchmarkCorpus()
- generateScenario()
- CorpusManifest

### 必须实现的公开接口

```ts
export function loadBenchmarkCorpus(manifestPath: string, access: CorpusAccess): Promise<BenchmarkCorpus>;
export function generateScenario(template: BenchmarkScenario, seed: number, outDir: string): Promise<GeneratedScenario>;
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

在 `packages/benchmark-corpus/test/adapters.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("generates byte-identical scenario artifacts for the same seed", async () => {
  const a = await generateScenario(template(), 42, tmp("a"));
  const b = await generateScenario(template(), 42, tmp("b"));
  expect(a.artifactHashes).toEqual(b.artifactHashes);
});

it("does not expose sealed hidden tasks through the public loader", async () => {
  const corpus = await loadBenchmarkCorpus(manifestPath(), { role: "developer" });
  expect(corpus.scenarios.every(s => s.hiddenTask === undefined)).toBe(true);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function template(): BenchmarkScenario {
  return loadScenario("corpus/templates/delayed-must-not-deploy.scenario.json");
}
function manifestPath(): string {
  return fixturePath("corpus/manifest.json");
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B16
set -o pipefail
pnpm vitest run packages/benchmark-corpus/test/adapters.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B16/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-corpus/src/adapters.ts` 先写类型和最小实现。实现必须遵循：

1. 模板+seed 生成 Repo、Session、Tool Logs 和 Oracle。
2. 所有 artifacts 内容寻址。
3. Real trajectory 经 secret scrub、license review、双人 Oracle。
4. External adapter 只映射，不修改原始 benchmark。
5. sealed hidden task 使用单独 access boundary；run worker 只在 continuation 阶段解封。

### Step 4 — 增加负例与故障测试

- [ ] 12 templates schema
- [ ] seed determinism
- [ ] license metadata
- [ ] PII/secret scan
- [ ] public/sealed boundary
- [ ] external adapter missing fields
- [ ] corpus version immutability

```bash
set -o pipefail
pnpm vitest run packages/benchmark-corpus/test/adapters.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B16/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-corpus/test/adapters.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B16/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B16/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B16.json` 必须记录：

```json
{
  "taskId": "B16",
  "allowedFiles": ["benchmarks/corpus/manifest.json", "benchmarks/corpus/public/.gitkeep", "benchmarks/corpus/sealed/.gitkeep", "packages/benchmark-corpus/src/adapters.ts", "packages/benchmark-corpus/src/generator.ts", "packages/benchmark-corpus/test/adapters.test.ts", "packages/benchmark-corpus/test/generator.test.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B16/red.txt",
  "greenLog": "artifacts/task-evidence/B16/green.txt",
  "negativeLog": "artifacts/task-evidence/B16/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B16/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B16
python3 scripts/taskctl.py verify-evidence B16
```

### Step 8 — 原子提交

```bash
git add benchmarks/corpus/manifest.json benchmarks/corpus/public/.gitkeep benchmarks/corpus/sealed/.gitkeep packages/benchmark-corpus/src/adapters.ts packages/benchmark-corpus/src/generator.ts packages/benchmark-corpus/test/adapters.test.ts packages/benchmark-corpus/test/generator.test.ts artifacts/task-evidence/B16
git commit -m "feat(b16): Corpus and External Adapters"
python3 scripts/taskctl.py record-commit B16 HEAD
```

## 6. 完成验收

- [ ] W1 至少 60 boundaries 配额达标
- [ ] W2 至少 100
- [ ] 每场景 Artifact hashes 完整
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
