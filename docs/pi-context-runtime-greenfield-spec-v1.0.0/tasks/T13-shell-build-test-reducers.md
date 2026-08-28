# T13 — 实现 Bash/构建/测试日志 Reducers

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W1`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T13` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Bash/构建/测试日志 Reducers，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `reduceTestLog`

## 1. 先决条件

- [`T12`](T12-reducer-registry.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T12.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T13
python3 scripts/taskctl.py claim T13 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T13: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T13: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`16-reducer-architecture.md`](../16-reducer-architecture.md)
- [`15-observation-ingress.md`](../15-observation-ingress.md)

- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)

## 3. 文件边界

### Create

- packages/kernel/src/reducers/bash.ts
- packages/kernel/src/reducers/build-log.ts
- packages/kernel/src/reducers/test-log.ts
- packages/kernel/test/shell-reducers.test.ts

### Modify

- packages/kernel/src/reducers/index.ts

### Tests

- packages/kernel/test/shell-reducers.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T13/red.txt
- artifacts/task-evidence/T13/green.txt
- artifacts/task-evidence/T13/full-gate.txt
- artifacts/task-evidence/T13.json

### 唯一允许写入集合

- packages/kernel/src/reducers/bash.ts
- packages/kernel/src/reducers/build-log.ts
- packages/kernel/src/reducers/test-log.ts
- packages/kernel/test/shell-reducers.test.ts
- packages/kernel/src/reducers/index.ts
- artifacts/task-evidence/T13/red.txt
- artifacts/task-evidence/T13/green.txt
- artifacts/task-evidence/T13/full-gate.txt
- artifacts/task-evidence/T13.json

修改集合外文件时必须停止，并创建 `blockers/T13-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T12 registry/output contract

### Produces

- bash/build/test reducers
- exit code/error/failed-test/path extraction
- visible compact view with raw pointer

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 execute command
- 不 claim tests passed solely from assistant text
- 不 parse every framework in first revision

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { reduceTestLog } from "../src/reducers/test-log.js";

describe("test log reducer", () => {
  it("keeps failed tests, error window and exit code", () => {
    const output = reduceTestLog("PASS a.test.ts\nFAIL auth.test.ts\nExpected 200 received 500\nTests: 1 failed, 1 passed", { exitCode: 1 });
    expect(output.visibleText).toContain("FAIL auth.test.ts");
    expect(output.visibleText).toContain("exit=1");
    expect(output.visibleText).not.toContain("PASS a.test.ts");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T13
set -o pipefail
pnpm vitest run packages/kernel/test/shell-reducers.test.ts 2>&1 | tee artifacts/task-evidence/T13/red.txt
```

预期：失败原因是本任务主行为 `reduceTestLog` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function reduceTestLog(text: string, meta: { exitCode?: number }): ReducerOutput {
  const lines = normalizeLines(text);
  const failureIndexes = lines.flatMap((line, index) => /FAIL|FAILED|Error:|expected.*received/i.test(line) ? [index] : []);
  const selected = boundedWindows(lines, failureIndexes, { before: 2, after: 4, maxLines: 120 });
  return {
    visibleText: [`[test-result exit=${meta.exitCode ?? "unknown"}]`, ...selected, `[raw:${rawPointer()}]`].join("\n"),
    facts: extractTestFacts(lines, meta.exitCode)
  };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] ANSI/control chars normalized
- [ ] CJK error lines retained
- [ ] success summary compact
- [ ] huge single line bounded
- [ ] command echo containing injection remains data-labeled

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/shell-reducers.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T13/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T13/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T13.json`：

```json
{
  "taskId": "T13",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/reducers/bash.ts", "packages/kernel/src/reducers/build-log.ts", "packages/kernel/src/reducers/test-log.ts", "packages/kernel/test/shell-reducers.test.ts", "packages/kernel/src/reducers/index.ts", "artifacts/task-evidence/T13/red.txt", "artifacts/task-evidence/T13/green.txt", "artifacts/task-evidence/T13/full-gate.txt", "artifacts/task-evidence/T13.json"],
  "redLog": "artifacts/task-evidence/T13/red.txt",
  "greenLog": "artifacts/task-evidence/T13/green.txt",
  "fullGateLog": "artifacts/task-evidence/T13/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T13
python3 scripts/taskctl.py verify-evidence T13
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/reducers/bash.ts packages/kernel/src/reducers/build-log.ts packages/kernel/src/reducers/test-log.ts packages/kernel/test/shell-reducers.test.ts packages/kernel/src/reducers/index.ts artifacts/task-evidence/T13/red.txt artifacts/task-evidence/T13/green.txt artifacts/task-evidence/T13/full-gate.txt artifacts/task-evidence/T13.json
git commit -m "feat(t13): 实现 Bash/构建/测试日志 Reducers"
python3 scripts/taskctl.py record-commit T13 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：bash/build/test reducers
- [ ] 完成：exit code/error/failed-test/path extraction
- [ ] 完成：visible compact view with raw pointer
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T13` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- golden fixtures for npm/gradle/maven/cargo/pytest
- failure evidence outranks progress noise
- raw pointer always present when truncated

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
