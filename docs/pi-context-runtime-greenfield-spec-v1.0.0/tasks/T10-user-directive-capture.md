# T10 — 实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W1`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T10` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `captureUserDirectives`

## 1. 先决条件

- [`T09`](T09-raw-input-receipt.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T09.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T10
python3 scripts/taskctl.py claim T10 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T10: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T10: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`17-user-directive-lane.md`](../17-user-directive-lane.md)
- [`24-materialization.md`](../24-materialization.md)

- [`adrs/0011-authenticated-directive-lane.md`](../adrs/0011-authenticated-directive-lane.md)
- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)

## 3. 文件边界

### Create

- packages/kernel/src/directives/capture.ts
- packages/kernel/src/directives/store.ts
- packages/kernel/test/directive-capture.test.ts

### Modify

- packages/contracts/src/types.ts
- packages/storage/src/protocol.ts

### Tests

- packages/kernel/test/directive-capture.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T10/red.txt
- artifacts/task-evidence/T10/green.txt
- artifacts/task-evidence/T10/full-gate.txt
- artifacts/task-evidence/T10.json

### 唯一允许写入集合

- packages/kernel/src/directives/capture.ts
- packages/kernel/src/directives/store.ts
- packages/kernel/test/directive-capture.test.ts
- packages/contracts/src/types.ts
- packages/storage/src/protocol.ts
- artifacts/task-evidence/T10/red.txt
- artifacts/task-evidence/T10/green.txt
- artifacts/task-evidence/T10/full-gate.txt
- artifacts/task-evidence/T10.json

修改集合外文件时必须停止，并创建 `blockers/T10-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T09 linked input receipts

### Produces

- UserDirective append/supersede APIs
- exact quote verifier
- directive renderer with hard budget
- no semantic auto-retirement

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不承诺理解任意隐式自然语言约束
- 不由 semantic model 创建或退休 directive
- 不把全部历史 user text常驻 prompt

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { captureUserDirectives } from "../src/directives/capture.js";

describe("directive capture", () => {
  it("preserves prohibition, number and path as exact quoted evidence", () => {
    const text = "不要修改 public API；测试至少运行 3 次，文件是 src/api.ts。";
    const [directive] = captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" });
    expect(text.slice(directive.byteRange.start, directive.byteRange.end)).toBe(directive.quote);
    expect(directive.polarity).toBe("must-not");
    expect(directive.status).toBe("active");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T10
set -o pipefail
pnpm vitest run packages/kernel/test/directive-capture.test.ts 2>&1 | tee artifacts/task-evidence/T10/red.txt
```

预期：失败原因是本任务主行为 `captureUserDirectives` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function captureUserDirectives(input: DirectiveCaptureInput): UserDirective[] {
  if (input.sourceClass !== "authenticated-user") return [];
  return explicitDirectiveSpans(input.text).map((span) => ({
    directiveId: makeDirectiveId(input.messageId, span.start, span.end),
    sourceMessageId: input.messageId,
    sourceContentHash: domainHash("user-message", input.text),
    quote: input.text.slice(span.start, span.end),
    byteRange: { start: span.start, end: span.end },
    kind: span.kind, polarity: span.polarity, status: "active",
    sourceClass: "authenticated-user", authority: "act"
  }));
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] untrusted/agent-derived input yields no hard directive
- [ ] later authenticated correction supersedes exact target only
- [ ] active directive cannot be silently dropped under pressure
- [ ] DIRECTIVE_BUDGET_EXCEEDED is typed

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/directive-capture.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T10/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T10/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T10.json`：

```json
{
  "taskId": "T10",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/directives/capture.ts", "packages/kernel/src/directives/store.ts", "packages/kernel/test/directive-capture.test.ts", "packages/contracts/src/types.ts", "packages/storage/src/protocol.ts", "artifacts/task-evidence/T10/red.txt", "artifacts/task-evidence/T10/green.txt", "artifacts/task-evidence/T10/full-gate.txt", "artifacts/task-evidence/T10.json"],
  "redLog": "artifacts/task-evidence/T10/red.txt",
  "greenLog": "artifacts/task-evidence/T10/green.txt",
  "fullGateLog": "artifacts/task-evidence/T10/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T10
python3 scripts/taskctl.py verify-evidence T10
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/directives/capture.ts packages/kernel/src/directives/store.ts packages/kernel/test/directive-capture.test.ts packages/contracts/src/types.ts packages/storage/src/protocol.ts artifacts/task-evidence/T10/red.txt artifacts/task-evidence/T10/green.txt artifacts/task-evidence/T10/full-gate.txt artifacts/task-evidence/T10.json
git commit -m "feat(t10): 实现 Authenticated User Directive Lane 与 Quote/Byte-range 不变量"
python3 scripts/taskctl.py record-commit T10 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：UserDirective append/supersede APIs
- [ ] 完成：exact quote verifier
- [ ] 完成：directive renderer with hard budget
- [ ] 完成：no semantic auto-retirement
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T10` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- exact quote/hash/range validation
- supersession only from authenticated user
- constraint recall fixture included

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
