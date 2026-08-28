# T26 — 实现四区 Cache-aware Request Materializer 与 Reduction Ladder

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T26` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现四区 Cache-aware Request Materializer 与 Reduction Ladder，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `ContextMaterializer`

## 1. 先决条件

- [`T19`](T19-proactive-recall.md)：必须存在状态 `done` 和 evidence。
- [`T23`](T23-continuity-ledger.md)：必须存在状态 `done` 和 evidence。
- [`T24`](T24-token-accounting.md)：必须存在状态 `done` 和 evidence。
- [`T25`](T25-active-turn-suffix.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T19.json, artifacts/task-evidence/T23.json, artifacts/task-evidence/T24.json, artifacts/task-evidence/T25.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T26
python3 scripts/taskctl.py claim T26 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T26: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T26: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`24-materialization.md`](../24-materialization.md)
- [`23-token-accounting-and-budget.md`](../23-token-accounting-and-budget.md)

- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)
- [`adrs/0016-active-turn-suffix-is-atomic.md`](../adrs/0016-active-turn-suffix-is-atomic.md)

## 3. 文件边界

### Create

- packages/kernel/src/materialization/materializer.ts
- packages/kernel/src/materialization/cache-plan.ts
- packages/kernel/src/materialization/reduction.ts
- packages/kernel/test/materializer.test.ts

### Modify

- packages/kernel/src/index.ts

### Tests

- packages/kernel/test/materializer.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T26/red.txt
- artifacts/task-evidence/T26/green.txt
- artifacts/task-evidence/T26/full-gate.txt
- artifacts/task-evidence/T26.json

### 唯一允许写入集合

- packages/kernel/src/materialization/materializer.ts
- packages/kernel/src/materialization/cache-plan.ts
- packages/kernel/src/materialization/reduction.ts
- packages/kernel/test/materializer.test.ts
- packages/kernel/src/index.ts
- artifacts/task-evidence/T26/red.txt
- artifacts/task-evidence/T26/green.txt
- artifacts/task-evidence/T26/full-gate.txt
- artifacts/task-evidence/T26.json

修改集合外文件时必须停止，并创建 `blockers/T26-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T19 recall pages
- T23 continuity
- T24 budget
- T25 exact suffix

### Produces

- MaterializedView
- four cache zones
- deterministic section budgeting
- omission receipts/outputHash

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 mutate canonical messages
- 不 perform Pi conversion
- 不 call semantic model

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { ContextMaterializer } from "../src/materialization/materializer.js";

describe("materializer", () => {
  it("places volatile recall before the exact active-turn suffix and preserves user-last semantics", async () => {
    const view = await fixtureMaterializer().materialize(fixtureInput());
    expect(view.sections.map((x) => x.cacheZone)).toEqual(expect.arrayContaining(["stable-prefix","append-only-history","volatile-augmentation","active-turn"]));
    expect(view.messages.at(-1)?.sourceClass).toBe("authenticated-user");
    expect(view.tokenEstimate).toBeLessThanOrEqual(fixtureInput().currentContextWindow - fixtureInput().maxOutputTokens);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T26
set -o pipefail
pnpm vitest run packages/kernel/test/materializer.test.ts 2>&1 | tee artifacts/task-evidence/T26/red.txt
```

预期：失败原因是本任务主行为 `ContextMaterializer` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export class ContextMaterializer {
  async materialize(input: MaterializationInput): Promise<MaterializedView> {
    const budget = this.budget.resolve(input);
    const exactSuffix = buildExactActiveSuffix(input.canonicalMessages);
    const sections = await this.sections.build(input, exactSuffix);
    const selected = reduceSectionsToBudget(sections, budget, REDUCTION_LADDER);
    assertDirectivesPresent(selected); assertToolPairs(selected); assertExactSuffix(selected, exactSuffix);
    return buildMaterializedView(selected, budget);
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] directive overflow aborts
- [ ] drop order leases→directory→resolved state→history, never active directives/suffix
- [ ] same inputs produce same outputHash
- [ ] cache toggle cannot alter outputHash

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/materializer.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T26/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T26/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T26.json`：

```json
{
  "taskId": "T26",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/materialization/materializer.ts", "packages/kernel/src/materialization/cache-plan.ts", "packages/kernel/src/materialization/reduction.ts", "packages/kernel/test/materializer.test.ts", "packages/kernel/src/index.ts", "artifacts/task-evidence/T26/red.txt", "artifacts/task-evidence/T26/green.txt", "artifacts/task-evidence/T26/full-gate.txt", "artifacts/task-evidence/T26.json"],
  "redLog": "artifacts/task-evidence/T26/red.txt",
  "greenLog": "artifacts/task-evidence/T26/green.txt",
  "fullGateLog": "artifacts/task-evidence/T26/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T26
python3 scripts/taskctl.py verify-evidence T26
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/materialization/materializer.ts packages/kernel/src/materialization/cache-plan.ts packages/kernel/src/materialization/reduction.ts packages/kernel/test/materializer.test.ts packages/kernel/src/index.ts artifacts/task-evidence/T26/red.txt artifacts/task-evidence/T26/green.txt artifacts/task-evidence/T26/full-gate.txt artifacts/task-evidence/T26.json
git commit -m "feat(t26): 实现四区 Cache-aware Request Materializer 与 Reduction Ladder"
python3 scripts/taskctl.py record-commit T26 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：MaterializedView
- [ ] 完成：four cache zones
- [ ] 完成：deterministic section budgeting
- [ ] 完成：omission receipts/outputHash
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T26` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- zone order fixed
- first-different section/hash receipt
- all omissions explicit and reason-coded

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
