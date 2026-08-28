# T21 — 实现 Claim 冲突、Supersession、Retraction 与 Audit Slice

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T21` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Claim 冲突、Supersession、Retraction 与 Audit Slice，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `applyClaimTransition`

## 1. 先决条件

- [`T20`](T20-claim-ledger.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T20.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T21
python3 scripts/taskctl.py claim T21 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T21: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T21: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`19-claims-and-authority.md`](../19-claims-and-authority.md)
- [`17-user-directive-lane.md`](../17-user-directive-lane.md)

- [`adrs/0010-bitemporal-claims.md`](../adrs/0010-bitemporal-claims.md)
- [`adrs/0011-authenticated-directive-lane.md`](../adrs/0011-authenticated-directive-lane.md)

## 3. 文件边界

### Create

- packages/kernel/src/claims/resolve.ts
- packages/kernel/src/claims/transitions.ts
- packages/kernel/test/claim-transitions.test.ts

### Modify

- packages/kernel/src/claims/index.ts

### Tests

- packages/kernel/test/claim-transitions.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T21/red.txt
- artifacts/task-evidence/T21/green.txt
- artifacts/task-evidence/T21/full-gate.txt
- artifacts/task-evidence/T21.json

### 唯一允许写入集合

- packages/kernel/src/claims/resolve.ts
- packages/kernel/src/claims/transitions.ts
- packages/kernel/test/claim-transitions.test.ts
- packages/kernel/src/claims/index.ts
- artifacts/task-evidence/T21/red.txt
- artifacts/task-evidence/T21/green.txt
- artifacts/task-evidence/T21/full-gate.txt
- artifacts/task-evidence/T21.json

修改集合外文件时必须停止，并创建 `blockers/T21-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T20 ClaimLedger

### Produces

- typed transition rules
- current/audit projection
- conflict set
- directive-authorized supersession

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 use LLM judge for isolation decision
- 不 discard conflict loser
- 不 auto-merge incompatible values

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { applyClaimTransition } from "../src/claims/transitions.js";

describe("claim transitions", () => {
  it("does not allow agent-derived text to supersede an authenticated prohibition", () => {
    const result = applyClaimTransition(activeAuthenticatedConstraint(), agentDerivedReplacement());
    expect(result.kind).toBe("contested");
    expect(result.current.claimId).toBe("cl_original");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T21
set -o pipefail
pnpm vitest run packages/kernel/test/claim-transitions.test.ts 2>&1 | tee artifacts/task-evidence/T21/red.txt
```

预期：失败原因是本任务主行为 `applyClaimTransition` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function applyClaimTransition(current: Claim, incoming: Claim): ClaimTransitionResult {
  if (incoming.authority !== "act" && current.authority === "act") {
    return { kind: "contested", current, challenger: incoming };
  }
  if (!transitionPolicyAllows(current, incoming)) return { kind: "rejected", reason: "invalid-transition" };
  return { kind: "superseded", current: closeSystemTime(current, incoming.systemTime.start), next: incoming };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] last-writer is not automatic winner
- [ ] negative polarity distinct from absence
- [ ] retraction requires original authority or fresh user authorization
- [ ] audit rows excluded from default active query

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/claim-transitions.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T21/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T21/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T21.json`：

```json
{
  "taskId": "T21",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/claims/resolve.ts", "packages/kernel/src/claims/transitions.ts", "packages/kernel/test/claim-transitions.test.ts", "packages/kernel/src/claims/index.ts", "artifacts/task-evidence/T21/red.txt", "artifacts/task-evidence/T21/green.txt", "artifacts/task-evidence/T21/full-gate.txt", "artifacts/task-evidence/T21.json"],
  "redLog": "artifacts/task-evidence/T21/red.txt",
  "greenLog": "artifacts/task-evidence/T21/green.txt",
  "fullGateLog": "artifacts/task-evidence/T21/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T21
python3 scripts/taskctl.py verify-evidence T21
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/claims/resolve.ts packages/kernel/src/claims/transitions.ts packages/kernel/test/claim-transitions.test.ts packages/kernel/src/claims/index.ts artifacts/task-evidence/T21/red.txt artifacts/task-evidence/T21/green.txt artifacts/task-evidence/T21/full-gate.txt artifacts/task-evidence/T21.json
git commit -m "feat(t21): 实现 Claim 冲突、Supersession、Retraction 与 Audit Slice"
python3 scripts/taskctl.py record-commit T21 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：typed transition rules
- [ ] 完成：current/audit projection
- [ ] 完成：conflict set
- [ ] 完成：directive-authorized supersession
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T21` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- transition table exhaustive
- unknown strategy fails typed
- current and audit slices replay consistently

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
