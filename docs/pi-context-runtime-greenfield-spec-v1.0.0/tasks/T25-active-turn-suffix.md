# T25 — 实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T25` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `buildExactActiveSuffix`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。
- [`T15`](T15-evidence-units.md)：必须存在状态 `done` 和 evidence。
- [`T23`](T23-continuity-ledger.md)：必须存在状态 `done` 和 evidence。
- [`T24`](T24-token-accounting.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json, artifacts/task-evidence/T15.json, artifacts/task-evidence/T23.json, artifacts/task-evidence/T24.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T25
python3 scripts/taskctl.py claim T25 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T25: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T25: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`24-materialization.md`](../24-materialization.md)
- [`25-pi-context-hook.md`](../25-pi-context-hook.md)

- [`adrs/0016-active-turn-suffix-is-atomic.md`](../adrs/0016-active-turn-suffix-is-atomic.md)
- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)

## 3. 文件边界

### Create

- packages/kernel/src/materialization/active-suffix.ts
- packages/kernel/src/materialization/atomic-groups.ts
- packages/kernel/test/active-suffix.test.ts

### Modify

- packages/kernel/src/index.ts

### Tests

- packages/kernel/test/active-suffix.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T25/red.txt
- artifacts/task-evidence/T25/green.txt
- artifacts/task-evidence/T25/full-gate.txt
- artifacts/task-evidence/T25.json

### 唯一允许写入集合

- packages/kernel/src/materialization/active-suffix.ts
- packages/kernel/src/materialization/atomic-groups.ts
- packages/kernel/test/active-suffix.test.ts
- packages/kernel/src/index.ts
- artifacts/task-evidence/T25/red.txt
- artifacts/task-evidence/T25/green.txt
- artifacts/task-evidence/T25/full-gate.txt
- artifacts/task-evidence/T25.json

修改集合外文件时必须停止，并创建 `blockers/T25-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T02 HostMessage
- T15 pointers
- T23 task state
- T24 budget

### Produces

- active user-turn suffix builder
- tool call/result pair validator
- oversized group pointerization request

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 select historical relevance
- 不 reorder active messages
- 不 include hidden reasoning

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { buildExactActiveSuffix } from "../src/materialization/active-suffix.js";

describe("active suffix", () => {
  it("keeps the latest real user message and every following tool pair verbatim", () => {
    const suffix = buildExactActiveSuffix(fixtureConversationWithTwoTurns());
    expect(suffix[0]?.role).toBe("user");
    expect(suffix.at(-1)?.role).toBe("tool-result");
    expect(validateToolPairs(suffix).ok).toBe(true);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T25
set -o pipefail
pnpm vitest run packages/kernel/test/active-suffix.test.ts 2>&1 | tee artifacts/task-evidence/T25/red.txt
```

预期：失败原因是本任务主行为 `buildExactActiveSuffix` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function buildExactActiveSuffix(messages: readonly HostMessage[]): HostMessage[] {
  const start = findLatestAuthenticatedUserIndex(messages);
  if (start < 0) throw pcrError("PCR_UNREPAIRABLE_ACTIVE_TURN");
  const suffix = structuredClone(messages.slice(start));
  const pairing = validateToolPairs(suffix);
  if (!pairing.ok) throw pcrError("PCR_TOOL_PAIR_INVALID", pairing);
  return suffix;
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] latest synthetic custom message cannot replace real user anchor
- [ ] parallel tool results paired by call ID
- [ ] orphan tool result blocks
- [ ] oversized result asks for external pointer rather than truncating silently

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/active-suffix.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T25/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T25/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T25.json`：

```json
{
  "taskId": "T25",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/materialization/active-suffix.ts", "packages/kernel/src/materialization/atomic-groups.ts", "packages/kernel/test/active-suffix.test.ts", "packages/kernel/src/index.ts", "artifacts/task-evidence/T25/red.txt", "artifacts/task-evidence/T25/green.txt", "artifacts/task-evidence/T25/full-gate.txt", "artifacts/task-evidence/T25.json"],
  "redLog": "artifacts/task-evidence/T25/red.txt",
  "greenLog": "artifacts/task-evidence/T25/green.txt",
  "fullGateLog": "artifacts/task-evidence/T25/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T25
python3 scripts/taskctl.py verify-evidence T25
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/materialization/active-suffix.ts packages/kernel/src/materialization/atomic-groups.ts packages/kernel/test/active-suffix.test.ts packages/kernel/src/index.ts artifacts/task-evidence/T25/red.txt artifacts/task-evidence/T25/green.txt artifacts/task-evidence/T25/full-gate.txt artifacts/task-evidence/T25.json
git commit -m "feat(t25): 实现 Exact Active Turn Suffix 与 Tool Pairing Atomicity"
python3 scripts/taskctl.py record-commit T25 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：active user-turn suffix builder
- [ ] 完成：tool call/result pair validator
- [ ] 完成：oversized group pointerization request
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T25` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- byte-for-byte current user text
- tool pair closure
- typed unrecoverable error before provider call

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
