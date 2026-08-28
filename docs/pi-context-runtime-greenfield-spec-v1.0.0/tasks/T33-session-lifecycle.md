# T33 — 实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T33` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `registerSessionLifecycle`

## 1. 先决条件

- [`T08`](T08-saga-recovery.md)：必须存在状态 `done` 和 evidence。
- [`T27`](T27-context-hook-integration.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。
- [`T32`](T32-host-convergence-controller.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T08.json, artifacts/task-evidence/T27.json, artifacts/task-evidence/T31.json, artifacts/task-evidence/T32.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T33
python3 scripts/taskctl.py claim T33 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T33: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T33: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`28-session-lifecycle-branching.md`](../28-session-lifecycle-branching.md)
- [`11-workspace-session-branch-identity.md`](../11-workspace-session-branch-identity.md)

- [`adrs/0006-physical-workspace-isolation.md`](../adrs/0006-physical-workspace-isolation.md)
- [`adrs/0009-recoverable-saga-not-cross-store-acid.md`](../adrs/0009-recoverable-saga-not-cross-store-acid.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/lifecycle.ts
- packages/kernel/src/lifecycle/catch-up.ts
- packages/kernel/src/lifecycle/branch-scope.ts
- tests/contract/pi-session-lifecycle.test.ts

### Modify

- apps/pi-context-runtime/src/extension.ts

### Tests

- tests/contract/pi-session-lifecycle.test.ts

### Test fixture：Create or Modify

- tests/support/pi.ts

### Task Evidence

- artifacts/task-evidence/T33/red.txt
- artifacts/task-evidence/T33/green.txt
- artifacts/task-evidence/T33/full-gate.txt
- artifacts/task-evidence/T33.json

### 唯一允许写入集合

- packages/pi-adapter/src/lifecycle.ts
- packages/kernel/src/lifecycle/catch-up.ts
- packages/kernel/src/lifecycle/branch-scope.ts
- tests/contract/pi-session-lifecycle.test.ts
- apps/pi-context-runtime/src/extension.ts
- tests/support/pi.ts
- artifacts/task-evidence/T33/red.txt
- artifacts/task-evidence/T33/green.txt
- artifacts/task-evidence/T33/full-gate.txt
- artifacts/task-evidence/T33.json

修改集合外文件时必须停止，并创建 `blockers/T33-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T08 recovery
- T27 view hook
- T31 host commit
- T32 controller

### Produces

- session-scoped resource lifecycle
- branch scope/lineage hash
- pre-runtime session catch-up
- shutdown flush/close

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 copy data across workspaces
- 不 derive act claims from old summaries
- 不 rewind filesystem/process/network state

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { createPiHarnessWithRuntime } from "../support/pi.js";

describe("session lifecycle", () => {
  it("switches branch scope without pretending external side effects rolled back", async () => {
    const host = await createPiHarnessWithRuntime({ existingSideEffect: "process-42" });
    await host.navigateTree("old-leaf");
    expect(host.runtimeCursor.branchScope).not.toBe(host.previousBranchScope);
    expect(host.continuity.externalSideEffects[0].status).toBe("requires-revalidation");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T33
set -o pipefail
pnpm vitest run tests/contract/pi-session-lifecycle.test.ts 2>&1 | tee artifacts/task-evidence/T33/red.txt
```

预期：失败原因是本任务主行为 `registerSessionLifecycle` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function registerSessionLifecycle(pi: ExtensionAPI, runtime: PiRuntime): void {
  pi.on("session_start", async (event, ctx) => { await runtime.openSession(ctx, event.reason); });
  pi.on("session_tree", async (event, ctx) => { await runtime.switchBranch(ctx, event.newLeafId); });
  pi.on("session_shutdown", async (_event, ctx) => { await runtime.closeSession(ctx); });
  pi.on("model_select", async (_event, ctx) => { await runtime.invalidateRouteCandidates(ctx); });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] new/resume/fork/reload reasons
- [ ] legacy Pi session without raw blobs becomes degraded pointer-unavailable
- [ ] session switch closes old worker
- [ ] lineage hash protects branch-specific state

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/contract/pi-session-lifecycle.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T33/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T33/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T33.json`：

```json
{
  "taskId": "T33",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/lifecycle.ts", "packages/kernel/src/lifecycle/catch-up.ts", "packages/kernel/src/lifecycle/branch-scope.ts", "tests/contract/pi-session-lifecycle.test.ts", "apps/pi-context-runtime/src/extension.ts", "tests/support/pi.ts", "artifacts/task-evidence/T33/red.txt", "artifacts/task-evidence/T33/green.txt", "artifacts/task-evidence/T33/full-gate.txt", "artifacts/task-evidence/T33.json"],
  "redLog": "artifacts/task-evidence/T33/red.txt",
  "greenLog": "artifacts/task-evidence/T33/green.txt",
  "fullGateLog": "artifacts/task-evidence/T33/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T33
python3 scripts/taskctl.py verify-evidence T33
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/lifecycle.ts packages/kernel/src/lifecycle/catch-up.ts packages/kernel/src/lifecycle/branch-scope.ts tests/contract/pi-session-lifecycle.test.ts apps/pi-context-runtime/src/extension.ts tests/support/pi.ts artifacts/task-evidence/T33/red.txt artifacts/task-evidence/T33/green.txt artifacts/task-evidence/T33/full-gate.txt artifacts/task-evidence/T33.json
git commit -m "feat(t33): 实现 Session Start/Tree/Fork/Shutdown 的 Scope、Catch-up 与 Recovery"
python3 scripts/taskctl.py record-commit T33 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：session-scoped resource lifecycle
- [ ] 完成：branch scope/lineage hash
- [ ] 完成：pre-runtime session catch-up
- [ ] 完成：shutdown flush/close
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T33` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- catch-up idempotent
- resource lifecycle follows Pi docs
- branch restore shows external-state warning

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
