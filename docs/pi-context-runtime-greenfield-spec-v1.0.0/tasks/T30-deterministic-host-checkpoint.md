# T30 — 构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T30` 必须为 `pending` 或已解除 `blocked`  
**目标：** 构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `buildDeterministicCheckpointCandidate`

## 1. 先决条件

- [`T29`](T29-host-checkpoint-renderer.md)：必须存在状态 `done` 和 evidence。
- [`T15`](T15-evidence-units.md)：必须存在状态 `done` 和 evidence。
- [`T16`](T16-exact-evidence-read.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T29.json, artifacts/task-evidence/T15.json, artifacts/task-evidence/T16.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T30
python3 scripts/taskctl.py claim T30 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T30: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T30: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`27-pi-compaction-takeover.md`](../27-pi-compaction-takeover.md)
- [`23-token-accounting-and-budget.md`](../23-token-accounting-and-budget.md)

- [`adrs/0017-pi-native-compaction-as-host-convergence.md`](../adrs/0017-pi-native-compaction-as-host-convergence.md)
- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)

## 3. 文件边界

### Create

- packages/kernel/src/compaction/candidate.ts
- packages/kernel/src/compaction/shrink-gate.ts
- packages/kernel/test/checkpoint-candidate.test.ts

### Modify

- packages/kernel/src/compaction/index.ts

### Tests

- packages/kernel/test/checkpoint-candidate.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T30/red.txt
- artifacts/task-evidence/T30/green.txt
- artifacts/task-evidence/T30/full-gate.txt
- artifacts/task-evidence/T30.json

### 唯一允许写入集合

- packages/kernel/src/compaction/candidate.ts
- packages/kernel/src/compaction/shrink-gate.ts
- packages/kernel/test/checkpoint-candidate.test.ts
- packages/kernel/src/compaction/index.ts
- artifacts/task-evidence/T30/red.txt
- artifacts/task-evidence/T30/green.txt
- artifacts/task-evidence/T30/full-gate.txt
- artifacts/task-evidence/T30.json

修改集合外文件时必须停止，并创建 `blockers/T30-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T29 renderer
- T15 evidence
- T16 exact pointer validation

### Produces

- HostCompactionCandidate
- source/cut-point refs
- must-shrink validation
- deterministic emergency candidate

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 call LLM
- 不 modify Pi session
- 不 use uncommitted candidate

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { buildDeterministicCheckpointCandidate } from "../src/compaction/candidate.js";

describe("checkpoint candidate", () => {
  it("rejects a checkpoint that does not reduce the prepared host span", async () => {
    const result = await buildDeterministicCheckpointCandidate(fixturePreparation({ tokensBefore: 500 }), fixtureState({ renderedTokens: 600 }));
    expect(result).toMatchObject({ kind: "rejected", code: "PCR_HOST_COMPACTION_NOT_SHRINKING" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T30
set -o pipefail
pnpm vitest run packages/kernel/test/checkpoint-candidate.test.ts 2>&1 | tee artifacts/task-evidence/T30/red.txt
```

预期：失败原因是本任务主行为 `buildDeterministicCheckpointCandidate` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function buildDeterministicCheckpointCandidate(preparation: HostCompactionPreparation, state: RuntimeState): Promise<CandidateResult> {
  const checkpoint = buildHostCheckpoint(preparation, state);
  const summary = renderHostCheckpoint(checkpoint);
  const tokensAfter = state.counter.countText(summary) + state.counter.countMessages(preparation.retainedTail);
  if (tokensAfter >= preparation.tokensBefore) return { kind: "rejected", code: "PCR_HOST_COMPACTION_NOT_SHRINKING" };
  return { kind: "ready", candidate: { summary, firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore, details: manifest(checkpoint), estimatedTokensAfter: tokensAfter } };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] source branch/head matches preparation
- [ ] all pointers verify
- [ ] hard directive coverage 100%
- [ ] overflow candidate never waits for semantic worker

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/checkpoint-candidate.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T30/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T30/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T30.json`：

```json
{
  "taskId": "T30",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/compaction/candidate.ts", "packages/kernel/src/compaction/shrink-gate.ts", "packages/kernel/test/checkpoint-candidate.test.ts", "packages/kernel/src/compaction/index.ts", "artifacts/task-evidence/T30/red.txt", "artifacts/task-evidence/T30/green.txt", "artifacts/task-evidence/T30/full-gate.txt", "artifacts/task-evidence/T30.json"],
  "redLog": "artifacts/task-evidence/T30/red.txt",
  "greenLog": "artifacts/task-evidence/T30/green.txt",
  "fullGateLog": "artifacts/task-evidence/T30/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T30
python3 scripts/taskctl.py verify-evidence T30
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/compaction/candidate.ts packages/kernel/src/compaction/shrink-gate.ts packages/kernel/test/checkpoint-candidate.test.ts packages/kernel/src/compaction/index.ts artifacts/task-evidence/T30/red.txt artifacts/task-evidence/T30/green.txt artifacts/task-evidence/T30/full-gate.txt artifacts/task-evidence/T30.json
git commit -m "feat(t30): 构建 Deterministic Host Compaction Candidate 与 Must-shrink Gate"
python3 scripts/taskctl.py record-commit T30 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：HostCompactionCandidate
- [ ] 完成：source/cut-point refs
- [ ] 完成：must-shrink validation
- [ ] 完成：deterministic emergency candidate
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T30` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- strict shrink proof
- candidate identity binds cursor/config/schema
- rejection leaves host unchanged

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
