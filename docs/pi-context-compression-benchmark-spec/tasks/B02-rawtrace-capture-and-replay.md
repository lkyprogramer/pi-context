# B02 — RawTrace Capture and Replay

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** B01  
**目标：** 在任何 W1 reducer、Pi compaction 或 context rewrite 前捕获完整规范轨迹，并可重放为相同消息序列。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B02
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B02-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `packages/pi-benchmark-adapter/src/raw-trace.ts`
- `packages/pi-benchmark-adapter/src/pi-message-codec.ts`
- `packages/pi-benchmark-adapter/test/raw-trace.test.ts`
- `packages/pi-benchmark-adapter/test/fixtures/session-v3.jsonl`

此外只允许创建：

```text
artifacts/task-evidence/B02/red.txt
artifacts/task-evidence/B02/green.txt
artifacts/task-evidence/B02/negative.txt
artifacts/task-evidence/B02/full-gate.txt
artifacts/task-evidence/B02.json
```

## 3. 输入与输出合同

### Consumes

- RawTrace contract
- Pi public AgentMessage/SessionEntry types
- Session JSONL v3 fixture

### Produces

- captureRawTrace()
- replayRawTrace()
- RawTraceCaptureReceipt

### 必须实现的公开接口

```ts
export interface RawTraceCaptureInput {
  sessionId: string;
  branchLeafId: string;
  sessionEntries: readonly unknown[];
  rawToolObservations: ReadonlyMap<string, RawToolObservation>;
  modelRoute: ModelRoute;
  systemPromptHash: string;
  toolSchemaHash: string;
}
export function captureRawTrace(input: RawTraceCaptureInput): Promise<RawTrace>;
export function replayRawTrace(trace: RawTrace, sink: ReplaySink, signal?: AbortSignal): Promise<ReplayReceipt>;
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

在 `packages/pi-benchmark-adapter/test/raw-trace.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("uses the pre-reducer raw tool observation", async () => {
  const trace = await captureRawTrace(fixtureWithRawAndReducedToolResult());
  expect(trace.entries.find(e => e.entryId === "tool-1")?.contentSha256)
    .toBe(sha256("FULL RAW LOG"));
});

it("round-trips message order, toolCallId and branch leaf", async () => {
  const trace = await captureRawTrace(fixture());
  const replayed = await replayIntoMemory(trace);
  expect(replayed.messageDigest).toBe(trace.messageDigest);
  expect(replayed.branchLeafId).toBe(trace.boundary.leafId);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
const FULL_LOG = "line 1\nline 2\nERROR TS2322\nline 4";
function fixtureWithRawAndReducedToolResult(): RawTraceCaptureInput {
  return {
    sessionId: "s1", branchLeafId: "u2", modelRoute: { provider: "recorded", model: "reader-1" },
    systemPromptHash: "0".repeat(64), toolSchemaHash: "1".repeat(64),
    sessionEntries: [
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "fix build", timestamp: 1 } },
      { type: "message", id: "tool-1", parentId: "u1", message: { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "ERROR TS2322" }], isError: true, timestamp: 2 } },
    ],
    rawToolObservations: new Map([["call-1", { bytes: new TextEncoder().encode(FULL_LOG), mediaType: "text/plain" }]]),
  };
}
const fixture = fixtureWithRawAndReducedToolResult;
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B02
set -o pipefail
pnpm vitest run packages/pi-benchmark-adapter/test/raw-trace.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B02/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/pi-benchmark-adapter/src/raw-trace.ts` 先写类型和最小实现。实现必须遵循：

1. 优先使用 tool_result hook 捕获的 raw observation；Pi Session 中的 reduced result 只作 host-visible view。
2. 为 user/assistant/toolCall/toolResult/custom/compaction 分配稳定 entryId。
3. 隐藏 reasoning 不写入 model-visible payload，但其存在/长度进入 receipt，除非政策明确完全不持久化。
4. RawTrace canonical hash 覆盖顺序、role、content hash、toolCallId、timestamps normalized、model route。
5. Replay 不调用 Provider，只重建规范消息和 hook sequence。

### Step 4 — 增加负例与故障测试

- [ ] ANSI/Unicode/CJK/图片 metadata
- [ ] 并行 tool result 顺序
- [ ] 重复 capture 幂等
- [ ] 缺 raw observation 时标 degraded 而非伪造
- [ ] 取消后不发布半个 trace
- [ ] CompactionEntry 和 branch metadata 保留

```bash
set -o pipefail
pnpm vitest run packages/pi-benchmark-adapter/test/raw-trace.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B02/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/pi-benchmark-adapter/test/raw-trace.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B02/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B02/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B02.json` 必须记录：

```json
{
  "taskId": "B02",
  "allowedFiles": ["packages/pi-benchmark-adapter/src/raw-trace.ts", "packages/pi-benchmark-adapter/src/pi-message-codec.ts", "packages/pi-benchmark-adapter/test/raw-trace.test.ts", "packages/pi-benchmark-adapter/test/fixtures/session-v3.jsonl"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B02/red.txt",
  "greenLog": "artifacts/task-evidence/B02/green.txt",
  "negativeLog": "artifacts/task-evidence/B02/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B02/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B02
python3 scripts/taskctl.py verify-evidence B02
```

### Step 8 — 原子提交

```bash
git add packages/pi-benchmark-adapter/src/raw-trace.ts packages/pi-benchmark-adapter/src/pi-message-codec.ts packages/pi-benchmark-adapter/test/raw-trace.test.ts packages/pi-benchmark-adapter/test/fixtures/session-v3.jsonl artifacts/task-evidence/B02
git commit -m "feat(b02): RawTrace Capture and Replay"
python3 scripts/taskctl.py record-commit B02 HEAD
```

## 6. 完成验收

- [ ] 同 fixture 捕获三次 hash 一致
- [ ] 重放后 messageDigest 一致
- [ ] RawTrace 不含 Oracle 或 hidden continuation
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
