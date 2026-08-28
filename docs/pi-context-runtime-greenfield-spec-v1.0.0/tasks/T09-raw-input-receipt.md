# T09 — 捕获原始 Input Receipt 并关联 Pi 展开后的 User Message

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W1`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T09` 必须为 `pending` 或已解除 `blocked`  
**目标：** 捕获原始 Input Receipt 并关联 Pi 展开后的 User Message，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `InputCorrelator`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。
- [`T05`](T05-pi-contract-harness.md)：必须存在状态 `done` 和 evidence。
- [`T06`](T06-sqlite-store.md)：必须存在状态 `done` 和 evidence。
- [`T08`](T08-saga-recovery.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json, artifacts/task-evidence/T05.json, artifacts/task-evidence/T06.json, artifacts/task-evidence/T08.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T09
python3 scripts/taskctl.py claim T09 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T09: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T09: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`17-user-directive-lane.md`](../17-user-directive-lane.md)
- [`07-pi-public-api-mapping.md`](../07-pi-public-api-mapping.md)

- [`adrs/0011-authenticated-directive-lane.md`](../adrs/0011-authenticated-directive-lane.md)
- [`adrs/0005-dual-authority-boundary.md`](../adrs/0005-dual-authority-boundary.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/input-correlation.ts
- packages/kernel/src/directives/raw-input.ts
- packages/kernel/test/raw-input.test.ts
- tests/contract/pi-input-correlation.test.ts

### Modify

- packages/pi-adapter/src/index.ts

### Tests

- packages/kernel/test/raw-input.test.ts
- tests/contract/pi-input-correlation.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T09/red.txt
- artifacts/task-evidence/T09/green.txt
- artifacts/task-evidence/T09/full-gate.txt
- artifacts/task-evidence/T09.json

### 唯一允许写入集合

- packages/pi-adapter/src/input-correlation.ts
- packages/kernel/src/directives/raw-input.ts
- packages/kernel/test/raw-input.test.ts
- tests/contract/pi-input-correlation.test.ts
- packages/pi-adapter/src/index.ts
- artifacts/task-evidence/T09/red.txt
- artifacts/task-evidence/T09/green.txt
- artifacts/task-evidence/T09/full-gate.txt
- artifacts/task-evidence/T09.json

修改集合外文件时必须停止，并创建 `blockers/T09-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T05 Pi input/message_end harness
- T06 store
- T08 Saga

### Produces

- RawInputReceipt
- source-channel classification
- raw-to-expanded correlation by session/sequence/content hash

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不从 text 内容推断 authentication
- 不 extract directives yet
- 不 rewrite user message

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { InputCorrelator } from "../src/directives/raw-input.js";

describe("InputCorrelator", () => {
  it("keeps raw text while linking the expanded persisted user message", () => {
    const c = new InputCorrelator();
    const raw = c.capture({ sessionId: "s1", source: "interactive", text: "/skill:review src/x.ts", at: 10 });
    const linked = c.link(raw.operationId, { hostMessageId: "m1", expandedText: "<skill>...\nsrc/x.ts", at: 11 });
    expect(linked.rawText).toBe("/skill:review src/x.ts");
    expect(linked.sourceClass).toBe("authenticated-user");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T09
set -o pipefail
pnpm vitest run packages/kernel/test/raw-input.test.ts tests/contract/pi-input-correlation.test.ts 2>&1 | tee artifacts/task-evidence/T09/red.txt
```

预期：失败原因是本任务主行为 `InputCorrelator` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function classifyInputSource(source: "interactive" | "rpc" | "extension", trustedRpc = false): SourceClass {
  if (source === "interactive") return "authenticated-user";
  if (source === "rpc" && trustedRpc) return "authenticated-user";
  if (source === "extension") return "agent-derived";
  return "untrusted-user";
}

export class InputCorrelator {
  capture(input: RawInput): RawInputReceipt { return buildRawReceipt(input, classifyInputSource(input.source)); }
  link(operationId: string, message: ExpandedHostMessage): LinkedInputReceipt { return linkByOperation(operationId, message); }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] two queued identical texts do not cross-link
- [ ] steer/follow-up source identity preserved
- [ ] RPC trusted only with explicit authenticated channel
- [ ] orphan raw receipt expires by policy but remains auditable

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/raw-input.test.ts tests/contract/pi-input-correlation.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T09/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T09/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T09.json`：

```json
{
  "taskId": "T09",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/input-correlation.ts", "packages/kernel/src/directives/raw-input.ts", "packages/kernel/test/raw-input.test.ts", "tests/contract/pi-input-correlation.test.ts", "packages/pi-adapter/src/index.ts", "artifacts/task-evidence/T09/red.txt", "artifacts/task-evidence/T09/green.txt", "artifacts/task-evidence/T09/full-gate.txt", "artifacts/task-evidence/T09.json"],
  "redLog": "artifacts/task-evidence/T09/red.txt",
  "greenLog": "artifacts/task-evidence/T09/green.txt",
  "fullGateLog": "artifacts/task-evidence/T09/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T09
python3 scripts/taskctl.py verify-evidence T09
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/input-correlation.ts packages/kernel/src/directives/raw-input.ts packages/kernel/test/raw-input.test.ts tests/contract/pi-input-correlation.test.ts packages/pi-adapter/src/index.ts artifacts/task-evidence/T09/red.txt artifacts/task-evidence/T09/green.txt artifacts/task-evidence/T09/full-gate.txt artifacts/task-evidence/T09.json
git commit -m "feat(t09): 捕获原始 Input Receipt 并关联 Pi 展开后的 User Message"
python3 scripts/taskctl.py record-commit T09 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：RawInputReceipt
- [ ] 完成：source-channel classification
- [ ] 完成：raw-to-expanded correlation by session/sequence/content hash
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T09` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- raw and expanded forms both retained
- byte ranges refer to raw form
- correlation handles session switch safely

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
