# T39 — 实现 Recall/Search/Status/Pin 工具与运维命令

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W4`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T39` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Recall/Search/Status/Pin 工具与运维命令，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `registerRuntimeTools`

## 1. 先决条件

- [`T16`](T16-exact-evidence-read.md)：必须存在状态 `done` 和 evidence。
- [`T18`](T18-fts-catalog.md)：必须存在状态 `done` 和 evidence。
- [`T19`](T19-proactive-recall.md)：必须存在状态 `done` 和 evidence。
- [`T22`](T22-outcome-attestation-action-gate.md)：必须存在状态 `done` 和 evidence。
- [`T28`](T28-retrieval-leases.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T16.json, artifacts/task-evidence/T18.json, artifacts/task-evidence/T19.json, artifacts/task-evidence/T22.json, artifacts/task-evidence/T28.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T39
python3 scripts/taskctl.py claim T39 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T39: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T39: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`35-pi-package-installation.md`](../35-pi-package-installation.md)
- [`21-catalog-and-retrieval.md`](../21-catalog-and-retrieval.md)

- [`adrs/0013-exact-first-retrieval.md`](../adrs/0013-exact-first-retrieval.md)
- [`adrs/0014-purpose-bound-leases.md`](../adrs/0014-purpose-bound-leases.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/tools/recall.ts
- packages/pi-adapter/src/tools/search.ts
- packages/pi-adapter/src/tools/status.ts
- packages/pi-adapter/src/tools/pin.ts
- packages/pi-adapter/src/commands/context.ts
- packages/pi-adapter/test/runtime-tools.test.ts

### Modify

- apps/pi-context-runtime/src/extension.ts

### Tests

- packages/pi-adapter/test/runtime-tools.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T39/red.txt
- artifacts/task-evidence/T39/green.txt
- artifacts/task-evidence/T39/full-gate.txt
- artifacts/task-evidence/T39.json

### 唯一允许写入集合

- packages/pi-adapter/src/tools/recall.ts
- packages/pi-adapter/src/tools/search.ts
- packages/pi-adapter/src/tools/status.ts
- packages/pi-adapter/src/tools/pin.ts
- packages/pi-adapter/src/commands/context.ts
- packages/pi-adapter/test/runtime-tools.test.ts
- apps/pi-context-runtime/src/extension.ts
- artifacts/task-evidence/T39/red.txt
- artifacts/task-evidence/T39/green.txt
- artifacts/task-evidence/T39/full-gate.txt
- artifacts/task-evidence/T39.json

修改集合外文件时必须停止，并创建 `blockers/T39-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T16 exact read
- T18 search
- T19 page
- T22 gate
- T28 lease

### Produces

- `context_recall/search/status/pin` Pi tools
- `/context`, `/context-doctor`, `/context-compact` commands
- bounded display/details

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 expose arbitrary SQL/regex
- 不 let model pin act directives without user approval
- 不 return raw secrets

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { createRegisteredRuntimeTools } from "../src/tools/index.js";

describe("runtime tools", () => {
  it("returns a bounded exact evidence page and never emits secret metadata", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    const result = await tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa", maxTokens: 256 }, undefined, undefined, fixtureCtx());
    expect(result.content[0]?.text.length).toBeLessThan(2048);
    expect(JSON.stringify(result)).not.toContain("encryptionKey");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T39
set -o pipefail
pnpm vitest run packages/pi-adapter/test/runtime-tools.test.ts 2>&1 | tee artifacts/task-evidence/T39/red.txt
```

预期：失败原因是本任务主行为 `registerRuntimeTools` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function registerRuntimeTools(pi: ExtensionAPI, runtime: PiRuntime): void {
  for (const tool of createRegisteredRuntimeTools(runtime)) pi.registerTool(tool);
  pi.registerCommand("context", { description: "Show Pi Context Runtime status", handler: (_args, ctx) => runtime.commands.status(ctx) });
  pi.registerCommand("context-doctor", { description: "Run capability and storage diagnostics", handler: (_args, ctx) => runtime.commands.doctor(ctx) });
  pi.registerCommand("context-compact", { description: "Request settled host convergence", handler: (_args, ctx) => runtime.commands.compact(ctx) });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] invalid ID/range
- [ ] scope denial
- [ ] search limit/time budget
- [ ] pin requires authenticated user confirmation
- [ ] tool name collision detected

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/pi-adapter/test/runtime-tools.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T39/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T39/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T39.json`：

```json
{
  "taskId": "T39",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/tools/recall.ts", "packages/pi-adapter/src/tools/search.ts", "packages/pi-adapter/src/tools/status.ts", "packages/pi-adapter/src/tools/pin.ts", "packages/pi-adapter/src/commands/context.ts", "packages/pi-adapter/test/runtime-tools.test.ts", "apps/pi-context-runtime/src/extension.ts", "artifacts/task-evidence/T39/red.txt", "artifacts/task-evidence/T39/green.txt", "artifacts/task-evidence/T39/full-gate.txt", "artifacts/task-evidence/T39.json"],
  "redLog": "artifacts/task-evidence/T39/red.txt",
  "greenLog": "artifacts/task-evidence/T39/green.txt",
  "fullGateLog": "artifacts/task-evidence/T39/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T39
python3 scripts/taskctl.py verify-evidence T39
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/tools/recall.ts packages/pi-adapter/src/tools/search.ts packages/pi-adapter/src/tools/status.ts packages/pi-adapter/src/tools/pin.ts packages/pi-adapter/src/commands/context.ts packages/pi-adapter/test/runtime-tools.test.ts apps/pi-context-runtime/src/extension.ts artifacts/task-evidence/T39/red.txt artifacts/task-evidence/T39/green.txt artifacts/task-evidence/T39/full-gate.txt artifacts/task-evidence/T39.json
git commit -m "feat(t39): 实现 Recall/Search/Status/Pin 工具与运维命令"
python3 scripts/taskctl.py record-commit T39 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：`context_recall/search/status/pin` Pi tools
- [ ] 完成：`/context`, `/context-doctor`, `/context-compact` commands
- [ ] 完成：bounded display/details
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T39` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- TypeBox schemas strict
- Pi rendering details bounded
- commands work TUI/RPC/print

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
