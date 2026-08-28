# B05 — Pi Native Arm Runner

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B02, B03  
**目标：** 只使用 Pi Public API 在隔离环境运行真实 Pi Native Compaction，捕获输入、Preparation、CompactionEntry、Usage 和日志。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B05
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B05-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-arms/src/pi-native.ts`
- `packages/benchmark-arms/src/pi-host.ts`
- `packages/benchmark-arms/test/pi-native.test.ts`
- `packages/benchmark-arms/test/fakes/recorded-provider.ts`

此外只允许创建：

```text
artifacts/task-evidence/B05/red.txt
artifacts/task-evidence/B05/green.txt
artifacts/task-evidence/B05/negative.txt
artifacts/task-evidence/B05/full-gate.txt
artifacts/task-evidence/B05.json
```

## 3. 输入与输出合同

### Consumes

- RawTrace
- BoundarySnapshot
- ArmRunInput
- Pi public createAgentSession/Extension API

### Produces

- runPiNativeArm()
- PiNativeArmReceipt
- CompressionArtifact

### 必须实现的公开接口

```ts
export interface ArmRunInput {
  runId: string;
  scenario: BenchmarkScenario;
  trace: RawTrace;
  snapshot: BoundarySnapshot;
  arm: ArmManifest;
  budget: ContextBudget;
  provider: RecordedOrLiveProvider;
  signal?: AbortSignal;
}
export function runPiNativeArm(input: ArmRunInput): Promise<ArmRunResult>;
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

在 `packages/benchmark-arms/test/pi-native.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("runs Pi native compaction and records the real CompactionEntry", async () => {
  const result = await runPiNativeArm(nativeFixture());
  expect(result.artifact.armId).toBe("A0");
  expect(result.hostEvents.some(e => e.type === "session_compact")).toBe(true);
  expect(result.artifact.sourceTraceHash).toBe(nativeFixture().trace.rawTraceSha256);
});

it("does not load PCR context or compaction extensions", async () => {
  const result = await runPiNativeArm(nativeFixture());
  expect(result.composition.loadedOwners).toEqual(["pi-native"]);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
function nativeFixture(): ArmRunInput {
  return {
    runId: "run-a0", scenario: scenario("large-build-log"), trace: rawTrace("large-build-log"),
    snapshot: snapshot("large-build-log"), arm: arm({ armId: "A0", ingress: "pass-through", recall: "off", compactor: "pi-native", materializer: "off" }),
    budget: { effectiveInputTokens: 64_000, targetVisibleTokens: 20_000, retainedTailTokens: 12_000 },
    provider: recordedProvider("pi-native-summary.jsonl"),
  };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B05
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/pi-native.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B05/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-arms/src/pi-native.ts` 先写类型和最小实现。实现必须遵循：

1. 为每次 run 创建独立 Pi Home/Workspace。
2. 通过公开 API 创建/恢复 Session；不读取 Pi 私有模块。
3. 使用 recorded provider 做 unit/CI，live provider 只用于 gate profile。
4. 手动 arm 调 `session.compact()`；threshold/overflow scenario 走真实 public lifecycle。
5. 捕获 session_before_compact preparation 只用于审计，不返回自定义 compaction。
6. 读取 session_compact 的 CompactionEntry，转换为统一 Artifact。

### Step 4 — 增加负例与故障测试

- [ ] manual/threshold/overflow
- [ ] split-turn
- [ ] 旧 compaction summary
- [ ] Provider error
- [ ] aborted compaction
- [ ] usage/cache metadata
- [ ] Pi version capability mismatch

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/pi-native.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B05/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/pi-native.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B05/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B05/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B05.json` 必须记录：

```json
{
  "taskId": "B05",
  "allowedFiles": ["packages/benchmark-arms/src/pi-native.ts", "packages/benchmark-arms/src/pi-host.ts", "packages/benchmark-arms/test/pi-native.test.ts", "packages/benchmark-arms/test/fakes/recorded-provider.ts"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B05/red.txt",
  "greenLog": "artifacts/task-evidence/B05/green.txt",
  "negativeLog": "artifacts/task-evidence/B05/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B05/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B05
python3 scripts/taskctl.py verify-evidence B05
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-arms/src/pi-native.ts packages/benchmark-arms/src/pi-host.ts packages/benchmark-arms/test/pi-native.test.ts packages/benchmark-arms/test/fakes/recorded-provider.ts artifacts/task-evidence/B05
git commit -m "feat(b05): Pi Native Arm Runner"
python3 scripts/taskctl.py record-commit B05 HEAD
```

## 6. 完成验收

- [ ] A0 可在 clean install 重现
- [ ] 没有 PCR Hook
- [ ] 完整 Host logs 和 session file hash 被 Run Manifest 引用
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
