# T04 — 实现单一 Pi Extension Orchestrator 与进程级 Owner Claim

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T04` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现单一 Pi Extension Orchestrator 与进程级 Owner Claim，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `claimPiContextOwner`

## 1. 先决条件

- [`T01`](T01-workspace-scaffold.md)：必须存在状态 `done` 和 evidence。
- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T01.json, artifacts/task-evidence/T02.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T04
python3 scripts/taskctl.py claim T04 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T04: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T04: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`09-single-owner-governance.md`](../09-single-owner-governance.md)
- [`35-pi-package-installation.md`](../35-pi-package-installation.md)

- [`adrs/0003-single-pi-extension-owner.md`](../adrs/0003-single-pi-extension-owner.md)
- [`adrs/0004-public-pi-api-only.md`](../adrs/0004-public-pi-api-only.md)

## 3. 文件边界

### Create

- apps/pi-context-runtime/src/extension.ts
- apps/pi-context-runtime/src/owner.ts
- apps/pi-context-runtime/src/runtime.ts
- apps/pi-context-runtime/test/owner.test.ts

### Modify

- apps/pi-context-runtime/package.json

### Tests

- apps/pi-context-runtime/test/owner.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T04/red.txt
- artifacts/task-evidence/T04/green.txt
- artifacts/task-evidence/T04/full-gate.txt
- artifacts/task-evidence/T04.json

### 唯一允许写入集合

- apps/pi-context-runtime/src/extension.ts
- apps/pi-context-runtime/src/owner.ts
- apps/pi-context-runtime/src/runtime.ts
- apps/pi-context-runtime/test/owner.test.ts
- apps/pi-context-runtime/package.json
- artifacts/task-evidence/T04/red.txt
- artifacts/task-evidence/T04/green.txt
- artifacts/task-evidence/T04/full-gate.txt
- artifacts/task-evidence/T04.json

修改集合外文件时必须停止，并创建 `blockers/T04-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T01 app package
- T02 error codes

### Produces

- one default ExtensionFactory export
- `claimPiContextOwner`/release handle
- session-scoped runtime lifecycle container

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不实现 Kernel
- 不扫描 Pi 私有 extension registry
- 不靠 load order 声称绝对独占

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { claimPiContextOwner, resetOwnerForTest } from "../src/owner.js";

afterEach(resetOwnerForTest);
describe("single owner", () => {
  it("rejects a second runtime in the same process", () => {
    const first = claimPiContextOwner("instance-a");
    expect(() => claimPiContextOwner("instance-b")).toThrowError(/PCR_OWNER_ALREADY_CLAIMED/);
    first.release();
    expect(() => claimPiContextOwner("instance-b")).not.toThrow();
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T04
set -o pipefail
pnpm vitest run apps/pi-context-runtime/test/owner.test.ts 2>&1 | tee artifacts/task-evidence/T04/red.txt
```

预期：失败原因是本任务主行为 `claimPiContextOwner` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
const OWNER = Symbol.for("pi-context-runtime.owner.v1");
type Slot = { instanceId: string } | undefined;

export function claimPiContextOwner(instanceId: string): { release(): void } {
  const root = globalThis as typeof globalThis & { [OWNER]?: Slot };
  if (root[OWNER]) throw new Error(`PCR_OWNER_ALREADY_CLAIMED:${root[OWNER].instanceId}`);
  root[OWNER] = { instanceId };
  return { release: () => { if (root[OWNER]?.instanceId === instanceId) delete root[OWNER]; } };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] factory registers no hooks before owner claim succeeds
- [ ] session shutdown releases only session resources, not another owner
- [ ] reload does not leave duplicate timers or worker ports

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run apps/pi-context-runtime/test/owner.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T04/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T04/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T04.json`：

```json
{
  "taskId": "T04",
  "status": "done",
  "allowedFiles": ["apps/pi-context-runtime/src/extension.ts", "apps/pi-context-runtime/src/owner.ts", "apps/pi-context-runtime/src/runtime.ts", "apps/pi-context-runtime/test/owner.test.ts", "apps/pi-context-runtime/package.json", "artifacts/task-evidence/T04/red.txt", "artifacts/task-evidence/T04/green.txt", "artifacts/task-evidence/T04/full-gate.txt", "artifacts/task-evidence/T04.json"],
  "redLog": "artifacts/task-evidence/T04/red.txt",
  "greenLog": "artifacts/task-evidence/T04/green.txt",
  "fullGateLog": "artifacts/task-evidence/T04/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T04
python3 scripts/taskctl.py verify-evidence T04
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add apps/pi-context-runtime/src/extension.ts apps/pi-context-runtime/src/owner.ts apps/pi-context-runtime/src/runtime.ts apps/pi-context-runtime/test/owner.test.ts apps/pi-context-runtime/package.json artifacts/task-evidence/T04/red.txt artifacts/task-evidence/T04/green.txt artifacts/task-evidence/T04/full-gate.txt artifacts/task-evidence/T04.json
git commit -m "feat(t04): 实现单一 Pi Extension Orchestrator 与进程级 Owner Claim"
python3 scripts/taskctl.py record-commit T04 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：one default ExtensionFactory export
- [ ] 完成：`claimPiContextOwner`/release handle
- [ ] 完成：session-scoped runtime lifecycle container
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T04` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- single Extension entry
- known limitation for unknown rewriters is exposed
- resource startup deferred until session_start

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
