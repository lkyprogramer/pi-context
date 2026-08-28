# T31 — 接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T31` 必须为 `pending` 或已解除 `blocked`  
**目标：** 接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `registerCompactionHooks`

## 1. 先决条件

- [`T04`](T04-single-extension-orchestrator.md)：必须存在状态 `done` 和 evidence。
- [`T05`](T05-pi-contract-harness.md)：必须存在状态 `done` 和 evidence。
- [`T30`](T30-deterministic-host-checkpoint.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T04.json, artifacts/task-evidence/T05.json, artifacts/task-evidence/T30.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T31
python3 scripts/taskctl.py claim T31 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T31: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T31: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`27-pi-compaction-takeover.md`](../27-pi-compaction-takeover.md)
- [`07-pi-public-api-mapping.md`](../07-pi-public-api-mapping.md)

- [`adrs/0017-pi-native-compaction-as-host-convergence.md`](../adrs/0017-pi-native-compaction-as-host-convergence.md)
- [`adrs/0003-single-pi-extension-owner.md`](../adrs/0003-single-pi-extension-owner.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/compaction-hook.ts
- packages/pi-adapter/src/compaction-ack.ts
- tests/contract/pi-compaction-takeover.test.ts

### Modify

- apps/pi-context-runtime/src/extension.ts

### Tests

- tests/contract/pi-compaction-takeover.test.ts

### Test fixture：Create or Modify

- tests/support/pi.ts

### Task Evidence

- artifacts/task-evidence/T31/red.txt
- artifacts/task-evidence/T31/green.txt
- artifacts/task-evidence/T31/full-gate.txt
- artifacts/task-evidence/T31.json

### 唯一允许写入集合

- packages/pi-adapter/src/compaction-hook.ts
- packages/pi-adapter/src/compaction-ack.ts
- tests/contract/pi-compaction-takeover.test.ts
- apps/pi-context-runtime/src/extension.ts
- tests/support/pi.ts
- artifacts/task-evidence/T31/red.txt
- artifacts/task-evidence/T31/green.txt
- artifacts/task-evidence/T31/full-gate.txt
- artifacts/task-evidence/T31.json

修改集合外文件时必须停止，并创建 `blockers/T31-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T04 orchestrator
- T05 Pi compaction harness
- T30 candidate

### Produces

- session_before_compact provider
- CompactionResult mapping
- session_compact commit acknowledgment
- failed/cancel cleanup

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 invoke Pi private `compact()`
- 不 choose arbitrary cut point outside preparation
- 不 disable Pi compaction without replacement

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { createPiHarnessWithRuntime } from "../support/pi.js";

describe("compaction takeover", () => {
  it("uses the host preparation cut point and commits runtime generation only after session_compact", async () => {
    const host = await createPiHarnessWithRuntime();
    await host.compact("threshold");
    expect(host.events).toEqual(expect.arrayContaining(["session_before_compact", "host-compaction-written", "session_compact", "runtime-generation-committed"]));
    expect(host.indexOf("runtime-generation-committed")).toBeGreaterThan(host.indexOf("session_compact"));
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T31
set -o pipefail
pnpm vitest run tests/contract/pi-compaction-takeover.test.ts 2>&1 | tee artifacts/task-evidence/T31/red.txt
```

预期：失败原因是本任务主行为 `registerCompactionHooks` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function registerCompactionHooks(pi: ExtensionAPI, runtime: PiRuntime): void {
  pi.on("session_before_compact", async (event, ctx) => {
    const candidate = await runtime.buildCheckpoint(event.preparation, event.reason, ctx);
    if (candidate.kind !== "ready") return { cancel: true };
    await runtime.stageCompaction(candidate.candidate, ctx);
    return { compaction: runtime.toPiCompactionResult(candidate.candidate) };
  });
  pi.on("session_compact", async (event, ctx) => { await runtime.ackHostCompaction(event.compactionEntry, ctx); });
  pi.on("session_compact_failed", async (event, ctx) => { await runtime.failStagedCompaction(event, ctx); });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] manual instructions handled by policy and do not reuse stale candidate
- [ ] overflow uses deterministic path
- [ ] cancel does not commit runtime generation
- [ ] fromExtension/details verified

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/contract/pi-compaction-takeover.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T31/green.txt
```

任务修改最终 app 时，再运行：

```bash
pnpm --filter ./apps/pi-context-runtime typecheck
```

- [ ] **Step 6：运行受影响包和全局边界门**

```bash
set -o pipefail
{
  pnpm check:boundaries
  pnpm test
} 2>&1 | tee artifacts/task-evidence/T31/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T31.json`：

```json
{
  "taskId": "T31",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/compaction-hook.ts", "packages/pi-adapter/src/compaction-ack.ts", "tests/contract/pi-compaction-takeover.test.ts", "apps/pi-context-runtime/src/extension.ts", "tests/support/pi.ts", "artifacts/task-evidence/T31/red.txt", "artifacts/task-evidence/T31/green.txt", "artifacts/task-evidence/T31/full-gate.txt", "artifacts/task-evidence/T31.json"],
  "redLog": "artifacts/task-evidence/T31/red.txt",
  "greenLog": "artifacts/task-evidence/T31/green.txt",
  "fullGateLog": "artifacts/task-evidence/T31/full-gate.txt",
  "sourceDigest": "由 taskctl seal-evidence 计算；仅覆盖实现、测试和日志，不覆盖本 JSON",
  "acceptance": {
    "testsPassed": true,
    "typecheckPassed": true,
    "boundariesPassed": true,
    "scopeRespected": true
  }
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence T31
python3 scripts/taskctl.py verify-evidence T31
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/compaction-hook.ts packages/pi-adapter/src/compaction-ack.ts tests/contract/pi-compaction-takeover.test.ts apps/pi-context-runtime/src/extension.ts tests/support/pi.ts artifacts/task-evidence/T31/red.txt artifacts/task-evidence/T31/green.txt artifacts/task-evidence/T31/full-gate.txt artifacts/task-evidence/T31.json
git commit -m "feat(t31): 接管 Pi Manual/Threshold/Overflow Compaction 与 Commit Acknowledgment"
python3 scripts/taskctl.py record-commit T31 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：session_before_compact provider
- [ ] 完成：CompactionResult mapping
- [ ] 完成：session_compact commit acknowledgment
- [ ] 完成：failed/cancel cleanup
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T31` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- manual/threshold/overflow contract tests
- host commit is authority
- staged candidate recovery tested

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
