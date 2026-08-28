# T05 — 实现 Pi Public API Capability Probe 与契约测试宿主

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T05` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Pi Public API Capability Probe 与契约测试宿主，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `probePiCapabilities`

## 1. 先决条件

- [`T01`](T01-workspace-scaffold.md)：必须存在状态 `done` 和 evidence。
- [`T04`](T04-single-extension-orchestrator.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T01.json, artifacts/task-evidence/T04.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T05
python3 scripts/taskctl.py claim T05 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T05: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T05: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`07-pi-public-api-mapping.md`](../07-pi-public-api-mapping.md)
- [`36-compatibility-versioning.md`](../36-compatibility-versioning.md)

- [`adrs/0004-public-pi-api-only.md`](../adrs/0004-public-pi-api-only.md)
- [`adrs/0021-compat-lock-plus-runtime-probe.md`](../adrs/0021-compat-lock-plus-runtime-probe.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/capabilities.ts
- packages/testkit/src/fake-pi-host.ts
- packages/testkit/src/pi-contract-harness.ts
- tests/contract/pi-capability-probe.test.ts

### Modify

- packages/pi-adapter/package.json
- packages/testkit/package.json

### Tests

- tests/contract/pi-capability-probe.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T05/red.txt
- artifacts/task-evidence/T05/green.txt
- artifacts/task-evidence/T05/full-gate.txt
- artifacts/task-evidence/T05.json

### 唯一允许写入集合

- packages/pi-adapter/src/capabilities.ts
- packages/testkit/src/fake-pi-host.ts
- packages/testkit/src/pi-contract-harness.ts
- tests/contract/pi-capability-probe.test.ts
- packages/pi-adapter/package.json
- packages/testkit/package.json
- artifacts/task-evidence/T05/red.txt
- artifacts/task-evidence/T05/green.txt
- artifacts/task-evidence/T05/full-gate.txt
- artifacts/task-evidence/T05.json

修改集合外文件时必须停止，并创建 `blockers/T05-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T04 orchestrator lifecycle

### Produces

- `probePiCapabilities`
- `PiContractHarness`
- fake event pipeline preserving Pi fail-open/chaining semantics

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不使用 Pi private imports
- 不做 packed install yet
- 不模拟 provider payload internals

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { probePiCapabilities } from "../../packages/pi-adapter/src/capabilities.js";

describe("Pi capability probe", () => {
  it("fails closed when a load-bearing hook is unavailable", () => {
    const result = probePiCapabilities(new Set(["context", "tool_result"]));
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("session_before_compact");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T05
set -o pipefail
pnpm vitest run tests/contract/pi-capability-probe.test.ts 2>&1 | tee artifacts/task-evidence/T05/red.txt
```

预期：失败原因是本任务主行为 `probePiCapabilities` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export const REQUIRED_PI_CAPABILITIES = [
  "context", "tool_result", "tool_call", "input", "message_end",
  "session_before_compact", "session_compact", "session_start",
  "session_tree", "session_shutdown", "agent_settled", "appendEntry"
] as const;

export function probePiCapabilities(available: ReadonlySet<string>) {
  const missing = REQUIRED_PI_CAPABILITIES.filter((name) => !available.has(name));
  return Object.freeze({ ready: missing.length === 0, missing });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] fake host chains context and tool_result handlers in registration order
- [ ] handler exception is recorded and pipeline continues
- [ ] custom entry is excluded from fake LLM context

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/contract/pi-capability-probe.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T05/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T05/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T05.json`：

```json
{
  "taskId": "T05",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/capabilities.ts", "packages/testkit/src/fake-pi-host.ts", "packages/testkit/src/pi-contract-harness.ts", "tests/contract/pi-capability-probe.test.ts", "packages/pi-adapter/package.json", "packages/testkit/package.json", "artifacts/task-evidence/T05/red.txt", "artifacts/task-evidence/T05/green.txt", "artifacts/task-evidence/T05/full-gate.txt", "artifacts/task-evidence/T05.json"],
  "redLog": "artifacts/task-evidence/T05/red.txt",
  "greenLog": "artifacts/task-evidence/T05/green.txt",
  "fullGateLog": "artifacts/task-evidence/T05/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T05
python3 scripts/taskctl.py verify-evidence T05
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/capabilities.ts packages/testkit/src/fake-pi-host.ts packages/testkit/src/pi-contract-harness.ts tests/contract/pi-capability-probe.test.ts packages/pi-adapter/package.json packages/testkit/package.json artifacts/task-evidence/T05/red.txt artifacts/task-evidence/T05/green.txt artifacts/task-evidence/T05/full-gate.txt artifacts/task-evidence/T05.json
git commit -m "feat(t05): 实现 Pi Public API Capability Probe 与契约测试宿主"
python3 scripts/taskctl.py record-commit T05 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：`probePiCapabilities`
- [ ] 完成：`PiContractHarness`
- [ ] 完成：fake event pipeline preserving Pi fail-open/chaining semantics
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T05` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- fake semantics match pinned Pi source tests
- missing capability error includes exact names
- contract harness supports TUI/RPC/print modes

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
