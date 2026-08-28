# T28 — 实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T28` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `LeasePolicy`

## 1. 先决条件

- [`T19`](T19-proactive-recall.md)：必须存在状态 `done` 和 evidence。
- [`T23`](T23-continuity-ledger.md)：必须存在状态 `done` 和 evidence。
- [`T26`](T26-materializer.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T19.json, artifacts/task-evidence/T23.json, artifacts/task-evidence/T26.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T28
python3 scripts/taskctl.py claim T28 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T28: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T28: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`22-proactive-recall-and-leases.md`](../22-proactive-recall-and-leases.md)
- [`24-materialization.md`](../24-materialization.md)

- [`adrs/0014-purpose-bound-leases.md`](../adrs/0014-purpose-bound-leases.md)
- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)

## 3. 文件边界

### Create

- packages/kernel/src/retrieval/lease-store.ts
- packages/kernel/src/retrieval/lease-policy.ts
- packages/kernel/test/lease-lifecycle.test.ts

### Modify

- packages/storage/src/protocol.ts

### Tests

- packages/kernel/test/lease-lifecycle.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T28/red.txt
- artifacts/task-evidence/T28/green.txt
- artifacts/task-evidence/T28/full-gate.txt
- artifacts/task-evidence/T28.json

### 唯一允许写入集合

- packages/kernel/src/retrieval/lease-store.ts
- packages/kernel/src/retrieval/lease-policy.ts
- packages/kernel/test/lease-lifecycle.test.ts
- packages/storage/src/protocol.ts
- artifacts/task-evidence/T28/red.txt
- artifacts/task-evidence/T28/green.txt
- artifacts/task-evidence/T28/full-gate.txt
- artifacts/task-evidence/T28.json

修改集合外文件时必须停止，并创建 `blockers/T28-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T19 RetrievalPage
- T23 task fronts
- T26 materializer sections

### Produces

- Lease create/renew/release
- dependency and task-front binding
- absolute/turn/token caps
- lease omission reason

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 permanently append page to Pi Session
- 不 renew solely on recency
- 不 exceed materializer volatile budget

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { LeasePolicy } from "../src/retrieval/lease-policy.js";

describe("lease policy", () => {
  it("renews only while an unresolved action still depends on the evidence", () => {
    const policy = new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000 });
    expect(policy.next(activeLease(), unresolvedDependency())).toMatchObject({ action: "renew" });
    expect(policy.next(activeLease(), completedFront())).toMatchObject({ action: "release", reason: "task-completed" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T28
set -o pipefail
pnpm vitest run packages/kernel/test/lease-lifecycle.test.ts 2>&1 | tee artifacts/task-evidence/T28/red.txt
```

预期：失败原因是本任务主行为 `LeasePolicy` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export class LeasePolicy {
  next(lease: RetrievalLease, state: LeaseDependencyState): LeaseDecision {
    if (state.taskStatus === "completed" || state.taskStatus === "superseded") return { action: "release", reason: "task-completed" };
    if (state.evidenceSuperseded) return { action: "release", reason: "evidence-superseded" };
    if (lease.turns >= this.cfg.maxTurns || lease.tokenTurns >= this.cfg.maxTokenTurns) return { action: "release", reason: "budget-exhausted" };
    return state.unresolvedDependents > 0 ? { action: "renew" } : { action: "release", reason: "unused" };
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] absolute expiry always wins
- [ ] branch/session mismatch releases
- [ ] same page lease deduped
- [ ] retrieval result never becomes directive/act authority

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/lease-lifecycle.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T28/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T28/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T28.json`：

```json
{
  "taskId": "T28",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/retrieval/lease-store.ts", "packages/kernel/src/retrieval/lease-policy.ts", "packages/kernel/test/lease-lifecycle.test.ts", "packages/storage/src/protocol.ts", "artifacts/task-evidence/T28/red.txt", "artifacts/task-evidence/T28/green.txt", "artifacts/task-evidence/T28/full-gate.txt", "artifacts/task-evidence/T28.json"],
  "redLog": "artifacts/task-evidence/T28/red.txt",
  "greenLog": "artifacts/task-evidence/T28/green.txt",
  "fullGateLog": "artifacts/task-evidence/T28/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T28
python3 scripts/taskctl.py verify-evidence T28
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/retrieval/lease-store.ts packages/kernel/src/retrieval/lease-policy.ts packages/kernel/test/lease-lifecycle.test.ts packages/storage/src/protocol.ts artifacts/task-evidence/T28/red.txt artifacts/task-evidence/T28/green.txt artifacts/task-evidence/T28/full-gate.txt artifacts/task-evidence/T28.json
git commit -m "feat(t28): 实现 Purpose-bound Retrieval Lease 生命周期与 Token-turn Cap"
python3 scripts/taskctl.py record-commit T28 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：Lease create/renew/release
- [ ] 完成：dependency and task-front binding
- [ ] 完成：absolute/turn/token caps
- [ ] 完成：lease omission reason
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T28` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- lease reason/purpose/dependencies stored
- renewal deterministic
- token-turn accounting tested

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
