# B06 — W1 Arms A1/A2

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B05  
**目标：** 从同一 RawTrace 运行 W1 入口降噪与主动召回两种变体，仍使用 Pi Native Compaction。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B06
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B06-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/benchmark-arms/src/w1.ts`
- `packages/benchmark-arms/src/composition-guard.ts`
- `packages/benchmark-arms/test/w1.test.ts`
- `packages/benchmark-arms/test/fixtures/tool-heavy.json`

此外只允许创建：

```text
artifacts/task-evidence/B06/red.txt
artifacts/task-evidence/B06/green.txt
artifacts/task-evidence/B06/negative.txt
artifacts/task-evidence/B06/full-gate.txt
artifacts/task-evidence/B06.json
```

## 3. 输入与输出合同

### Consumes

- ArmRunInput
- W1 ingress/recovery/recall public adapter
- runPiNativeArm

### Produces

- runW1Arm()
- W1ShapedTrace
- RecallInjectionReceipt

### 必须实现的公开接口

```ts
export type W1ArmId = "A1" | "A2";
export function runW1Arm(input: ArmRunInput & { arm: ArmManifest & { armId: W1ArmId } }): Promise<ArmRunResult>;
export function buildW1ShapedTrace(trace: RawTrace, ingress: W1Ingress): Promise<W1ShapedTrace>;
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

在 `packages/benchmark-arms/test/w1.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("A1 stores raw bytes but sends the reduced tool result to Pi", async () => {
  const result = await runW1Arm(w1Fixture("A1"));
  expect(result.rawEvidence[0].sha256).toBe(sha256(FULL_LOG));
  expect(textOf(result.hostVisibleMessages)).not.toContain(FULL_LOG);
  expect(result.recallInjections).toHaveLength(0);
});

it("A2 injects only the relevant old error and keeps the latest user message last", async () => {
  const result = await runW1Arm(w1Fixture("A2"));
  expect(result.recallInjections.map(x => x.itemId)).toContain("old-error-1");
  expect(result.artifact.messages.at(-1)?.role).toBe("user");
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
const FULL_LOG = "progress 1\nprogress 2\nERROR EADDRINUSE 127.0.0.1:8080\n";
function w1Fixture(armId: "A1" | "A2"): ArmRunInput & { arm: ArmManifest } {
  return {
    ...nativeFixture(), runId: `run-${armId.toLowerCase()}`,
    arm: arm({ armId, ingress: "w1", recall: armId === "A2" ? "proactive" : "manual-only", compactor: "pi-native", materializer: "off" }),
    trace: traceWithOldErrorAndCurrentUser({ oldErrorId: "old-error-1", latestUser: "fix the port conflict" }),
  };
}
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B06
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w1.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B06/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-arms/src/w1.ts` 先写类型和最小实现。实现必须遵循：

1. A1/A2 均从 RawTrace 重新回放，禁止从 A0 host session 派生。
2. tool_result 顺序：raw capture/fsync → reducer → Pi-visible result。
3. A1 关闭 proactive recall；A2 使用同一 W1ShapedTrace 和 recall policy。
4. 所有 recall page 放在 volatile suffix，最新 authenticated user 保持最后。
5. Composition Guard 检测其他 context/tool_result/compaction owner。

### Step 4 — 增加负例与故障测试

- [ ] reducer success/fail-open/fail-closed
- [ ] raw CAS crash point
- [ ] recall needed/not-needed
- [ ] 重复证据防抖
- [ ] 跨 workspace query
- [ ] CJK error
- [ ] secret scrubbing
- [ ] Pi Native compaction remains active

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w1.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B06/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-arms/test/w1.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B06/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B06/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B06.json` 必须记录：

```json
{
  "taskId": "B06",
  "allowedFiles": ["packages/benchmark-arms/src/w1.ts", "packages/benchmark-arms/src/composition-guard.ts", "packages/benchmark-arms/test/w1.test.ts", "packages/benchmark-arms/test/fixtures/tool-heavy.json"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B06/red.txt",
  "greenLog": "artifacts/task-evidence/B06/green.txt",
  "negativeLog": "artifacts/task-evidence/B06/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B06/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B06
python3 scripts/taskctl.py verify-evidence B06
```

### Step 8 — 原子提交

```bash
git add packages/benchmark-arms/src/w1.ts packages/benchmark-arms/src/composition-guard.ts packages/benchmark-arms/test/w1.test.ts packages/benchmark-arms/test/fixtures/tool-heavy.json artifacts/task-evidence/B06
git commit -m "feat(b06): W1 Arms A1/A2"
python3 scripts/taskctl.py record-commit B06 HEAD
```

## 6. 完成验收

- [ ] A1/A2 的 sourceTraceHash 相同
- [ ] A1/A2 的 W1ShapedTrace hash 相同，仅 recall view 不同
- [ ] A1/A2 不使用 W2 Materializer
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
