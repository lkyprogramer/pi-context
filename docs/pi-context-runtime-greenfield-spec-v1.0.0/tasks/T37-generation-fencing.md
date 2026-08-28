# T37 — 实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W3`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T37` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `publishVerifiedGeneration`

## 1. 先决条件

- [`T34`](T34-background-candidates.md)：必须存在状态 `done` 和 evidence。
- [`T36`](T36-verifier.md)：必须存在状态 `done` 和 evidence。
- [`T08`](T08-saga-recovery.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T34.json, artifacts/task-evidence/T36.json, artifacts/task-evidence/T08.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T37
python3 scripts/taskctl.py claim T37 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T37: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T37: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`29-background-generation.md`](../29-background-generation.md)
- [`14-saga-and-recovery.md`](../14-saga-and-recovery.md)

- [`adrs/0018-semantic-proposal-not-authority.md`](../adrs/0018-semantic-proposal-not-authority.md)
- [`adrs/0009-recoverable-saga-not-cross-store-acid.md`](../adrs/0009-recoverable-saga-not-cross-store-acid.md)

## 3. 文件边界

### Create

- packages/worker/src/generation/publish.ts
- packages/worker/src/generation/head.ts
- packages/worker/test/generation-fencing.test.ts

### Modify

- packages/storage/src/protocol.ts

### Tests

- packages/worker/test/generation-fencing.test.ts

### Test fixture：Create or Modify

- packages/worker/test/support.ts

### Task Evidence

- artifacts/task-evidence/T37/red.txt
- artifacts/task-evidence/T37/green.txt
- artifacts/task-evidence/T37/full-gate.txt
- artifacts/task-evidence/T37.json

### 唯一允许写入集合

- packages/worker/src/generation/publish.ts
- packages/worker/src/generation/head.ts
- packages/worker/test/generation-fencing.test.ts
- packages/storage/src/protocol.ts
- packages/worker/test/support.ts
- artifacts/task-evidence/T37/red.txt
- artifacts/task-evidence/T37/green.txt
- artifacts/task-evidence/T37/full-gate.txt
- artifacts/task-evidence/T37.json

修改集合外文件时必须停止，并创建 `blockers/T37-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T34 candidate key
- T36 verifier report
- T08 Saga/CAS state

### Produces

- ContextHead
- compare-and-swap publish
- verified generation manifest
- stale/rejected terminal states

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 wait in overflow path
- 不 mutate Pi JSONL
- 不 overwrite head without compare

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { generationFixture } from "./support.js";

describe("generation fencing", () => {
  it("loses CAS when a newer user directive advances the head", async () => {
    const fx = generationFixture();
    const prepared = await fx.prepare();
    await fx.appendDirective();
    const result = await fx.publish(prepared);
    expect(result).toMatchObject({ kind: "stale", reason: "head-changed" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T37
set -o pipefail
pnpm vitest run packages/worker/test/generation-fencing.test.ts 2>&1 | tee artifacts/task-evidence/T37/red.txt
```

预期：失败原因是本任务主行为 `publishVerifiedGeneration` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function publishVerifiedGeneration(input: PublishInput, deps: PublishDeps): Promise<PublishResult> {
  if (!input.report.ok) return deps.store.rejectGeneration(input.generationId, "verifier-failed");
  return deps.store.transaction(async (tx) => {
    const head = await tx.getContextHead(input.cursor);
    if (head.hash !== input.expectedHeadHash) return tx.markGenerationStale(input.generationId, "head-changed");
    const next = deriveNextHead(head, input.manifest);
    return tx.compareAndSwapContextHead(head.hash, next, input.generationId);
  });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] config/reducer/schema/model changes stale
- [ ] duplicate publish idempotent
- [ ] crash after generation insert before head CAS
- [ ] only committed generations materialized

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/worker/test/generation-fencing.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T37/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T37/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T37.json`：

```json
{
  "taskId": "T37",
  "status": "done",
  "allowedFiles": ["packages/worker/src/generation/publish.ts", "packages/worker/src/generation/head.ts", "packages/worker/test/generation-fencing.test.ts", "packages/storage/src/protocol.ts", "packages/worker/test/support.ts", "artifacts/task-evidence/T37/red.txt", "artifacts/task-evidence/T37/green.txt", "artifacts/task-evidence/T37/full-gate.txt", "artifacts/task-evidence/T37.json"],
  "redLog": "artifacts/task-evidence/T37/red.txt",
  "greenLog": "artifacts/task-evidence/T37/green.txt",
  "fullGateLog": "artifacts/task-evidence/T37/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T37
python3 scripts/taskctl.py verify-evidence T37
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/worker/src/generation/publish.ts packages/worker/src/generation/head.ts packages/worker/test/generation-fencing.test.ts packages/storage/src/protocol.ts packages/worker/test/support.ts artifacts/task-evidence/T37/red.txt artifacts/task-evidence/T37/green.txt artifacts/task-evidence/T37/full-gate.txt artifacts/task-evidence/T37.json
git commit -m "feat(t37): 实现 Verified Generation CAS Publish、Head Fencing 与 Stale Discard"
python3 scripts/taskctl.py record-commit T37 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：ContextHead
- [ ] 完成：compare-and-swap publish
- [ ] 完成：verified generation manifest
- [ ] 完成：stale/rejected terminal states
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T37` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- full fencing key
- transaction receipt
- startup recovery for half-published generation

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
