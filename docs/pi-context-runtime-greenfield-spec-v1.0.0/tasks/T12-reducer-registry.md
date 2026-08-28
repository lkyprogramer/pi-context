# T12 — 实现确定性 Reducer Registry、Revision 路由与资源限制

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W1`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T12` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现确定性 Reducer Registry、Revision 路由与资源限制，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `ReducerRegistry`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。
- [`T11`](T11-tool-result-raw-capture.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json, artifacts/task-evidence/T11.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T12
python3 scripts/taskctl.py claim T12 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T12: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T12: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`16-reducer-architecture.md`](../16-reducer-architecture.md)
- [`15-observation-ingress.md`](../15-observation-ingress.md)

- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)
- [`adrs/0005-dual-authority-boundary.md`](../adrs/0005-dual-authority-boundary.md)

## 3. 文件边界

### Create

- packages/kernel/src/reducers/types.ts
- packages/kernel/src/reducers/registry.ts
- packages/kernel/src/reducers/default.ts
- packages/kernel/test/reducer-registry.test.ts

### Modify

- packages/kernel/src/index.ts

### Tests

- packages/kernel/test/reducer-registry.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T12/red.txt
- artifacts/task-evidence/T12/green.txt
- artifacts/task-evidence/T12/full-gate.txt
- artifacts/task-evidence/T12.json

### 唯一允许写入集合

- packages/kernel/src/reducers/types.ts
- packages/kernel/src/reducers/registry.ts
- packages/kernel/src/reducers/default.ts
- packages/kernel/test/reducer-registry.test.ts
- packages/kernel/src/index.ts
- artifacts/task-evidence/T12/red.txt
- artifacts/task-evidence/T12/green.txt
- artifacts/task-evidence/T12/full-gate.txt
- artifacts/task-evidence/T12.json

修改集合外文件时必须停止，并创建 `blockers/T12-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T11 captured observation/raw pointer

### Produces

- Reducer interface
- registration fingerprint
- bounded deterministic execution
- default pointer reducer

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不调用 shell/network/LLM
- 不 infer action authority from text
- 不 implement tool-specific parsing

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { ReducerRegistry } from "../src/reducers/registry.js";

describe("ReducerRegistry", () => {
  it("routes by explicit tool matcher and records immutable revision", async () => {
    const registry = new ReducerRegistry();
    registry.register({ id: "bash", revision: "1", matches: (x) => x.toolName === "bash", reduce: async () => ({ visibleText: "ok", facts: [] }) });
    const result = await registry.reduce({ toolName: "bash" } as never);
    expect(result.reducer).toEqual({ id: "bash", revision: "1" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T12
set -o pipefail
pnpm vitest run packages/kernel/test/reducer-registry.test.ts 2>&1 | tee artifacts/task-evidence/T12/red.txt
```

预期：失败原因是本任务主行为 `ReducerRegistry` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export interface ObservationReducer {
  readonly id: string; readonly revision: string;
  matches(input: CapturedObservation): boolean;
  reduce(input: CapturedObservation, limits: ReducerLimits): Promise<ReducerOutput>;
}
export class ReducerRegistry {
  private readonly reducers: ObservationReducer[] = [];
  register(reducer: ObservationReducer): void {
    if (this.reducers.some((x) => x.id === reducer.id)) throw new Error(`duplicate reducer:${reducer.id}`);
    this.reducers.push(reducer);
  }
  async reduce(input: CapturedObservation): Promise<ReducedObservation> {
    const reducer = this.reducers.find((x) => x.matches(input)) ?? defaultPointerReducer;
    return { ...(await reducer.reduce(input, DEFAULT_LIMITS)), reducer: { id: reducer.id, revision: reducer.revision } };
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] duplicate reducer ID rejected
- [ ] timeout/size limit yields pointer fallback
- [ ] reducer cannot change raw blob/hash/source class
- [ ] same input/revision produces same canonical output

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/reducer-registry.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T12/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T12/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T12.json`：

```json
{
  "taskId": "T12",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/reducers/types.ts", "packages/kernel/src/reducers/registry.ts", "packages/kernel/src/reducers/default.ts", "packages/kernel/test/reducer-registry.test.ts", "packages/kernel/src/index.ts", "artifacts/task-evidence/T12/red.txt", "artifacts/task-evidence/T12/green.txt", "artifacts/task-evidence/T12/full-gate.txt", "artifacts/task-evidence/T12.json"],
  "redLog": "artifacts/task-evidence/T12/red.txt",
  "greenLog": "artifacts/task-evidence/T12/green.txt",
  "fullGateLog": "artifacts/task-evidence/T12/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T12
python3 scripts/taskctl.py verify-evidence T12
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/reducers/types.ts packages/kernel/src/reducers/registry.ts packages/kernel/src/reducers/default.ts packages/kernel/test/reducer-registry.test.ts packages/kernel/src/index.ts artifacts/task-evidence/T12/red.txt artifacts/task-evidence/T12/green.txt artifacts/task-evidence/T12/full-gate.txt artifacts/task-evidence/T12.json
git commit -m "feat(t12): 实现确定性 Reducer Registry、Revision 路由与资源限制"
python3 scripts/taskctl.py record-commit T12 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：Reducer interface
- [ ] 完成：registration fingerprint
- [ ] 完成：bounded deterministic execution
- [ ] 完成：default pointer reducer
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T12` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- determinism property test
- revision enters evidence identity
- unknown tool retains pointer and error/status metadata

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
