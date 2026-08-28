# T27 — 接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T27` 必须为 `pending` 或已解除 `blocked`  
**目标：** 接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `registerContextHook`

## 1. 先决条件

- [`T04`](T04-single-extension-orchestrator.md)：必须存在状态 `done` 和 evidence。
- [`T05`](T05-pi-contract-harness.md)：必须存在状态 `done` 和 evidence。
- [`T26`](T26-materializer.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T04.json, artifacts/task-evidence/T05.json, artifacts/task-evidence/T26.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T27
python3 scripts/taskctl.py claim T27 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T27: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T27: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`25-pi-context-hook.md`](../25-pi-context-hook.md)
- [`07-pi-public-api-mapping.md`](../07-pi-public-api-mapping.md)

- [`adrs/0003-single-pi-extension-owner.md`](../adrs/0003-single-pi-extension-owner.md)
- [`adrs/0015-cache-stable-four-zone-layout.md`](../adrs/0015-cache-stable-four-zone-layout.md)

## 3. 文件边界

### Create

- packages/pi-adapter/src/message-conversion.ts
- packages/pi-adapter/src/context-hook.ts
- tests/contract/pi-context-hook.test.ts

### Modify

- apps/pi-context-runtime/src/extension.ts
- packages/pi-adapter/src/index.ts

### Tests

- tests/contract/pi-context-hook.test.ts

### Test fixture：Create or Modify

- tests/support/pi.ts

### Task Evidence

- artifacts/task-evidence/T27/red.txt
- artifacts/task-evidence/T27/green.txt
- artifacts/task-evidence/T27/full-gate.txt
- artifacts/task-evidence/T27.json

### 唯一允许写入集合

- packages/pi-adapter/src/message-conversion.ts
- packages/pi-adapter/src/context-hook.ts
- tests/contract/pi-context-hook.test.ts
- apps/pi-context-runtime/src/extension.ts
- packages/pi-adapter/src/index.ts
- tests/support/pi.ts
- artifacts/task-evidence/T27/red.txt
- artifacts/task-evidence/T27/green.txt
- artifacts/task-evidence/T27/full-gate.txt
- artifacts/task-evidence/T27.json

修改集合外文件时必须停止，并创建 `blockers/T27-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T04 orchestrator
- T05 Pi harness
- T26 Materializer

### Produces

- Pi AgentMessage↔HostMessage conversion
- single context handler
- hard failure abort+safe view
- view receipt staging

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 rewrite provider payload
- 不 import Pi src files
- 不 claim exclusive order against unknown plugins

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { createPiHarnessWithRuntime } from "../support/pi.js";

describe("Pi context hook", () => {
  it("returns materialized messages before convertToLlm and aborts on hard safety failure", async () => {
    const host = await createPiHarnessWithRuntime({ materializeError: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    const messages = await host.emitContext(fixturePiMessages());
    expect(host.abortCalls).toBe(1);
    expect(messages.at(-1)?.role).toBe("user");
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T27
set -o pipefail
pnpm vitest run tests/contract/pi-context-hook.test.ts 2>&1 | tee artifacts/task-evidence/T27/red.txt
```

预期：失败原因是本任务主行为 `registerContextHook` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function registerContextHook(pi: ExtensionAPI, runtime: PiRuntime): void {
  pi.on("context", async (event, ctx) => {
    try {
      const input = await runtime.buildMaterializationInput(event.messages, ctx);
      const view = await runtime.kernel.materialize(input);
      await runtime.stageViewReceipt(view, ctx);
      return { messages: runtime.converter.toPi(view.messages) };
    } catch (error) {
      const pcr = normalizePcrError(error);
      if (pcr.severity === "hard") { ctx.abort(); return { messages: runtime.safeDiagnostic(event.messages, pcr) }; }
      return { messages: runtime.deterministicFallback(event.messages, pcr) };
    }
  });
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] Pi handler exception never escapes intentionally
- [ ] role conversion covers custom/compaction/branch summaries
- [ ] original user remains last
- [ ] unsupported custom content labeled agent-derived

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/contract/pi-context-hook.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T27/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T27/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T27.json`：

```json
{
  "taskId": "T27",
  "status": "done",
  "allowedFiles": ["packages/pi-adapter/src/message-conversion.ts", "packages/pi-adapter/src/context-hook.ts", "tests/contract/pi-context-hook.test.ts", "apps/pi-context-runtime/src/extension.ts", "packages/pi-adapter/src/index.ts", "tests/support/pi.ts", "artifacts/task-evidence/T27/red.txt", "artifacts/task-evidence/T27/green.txt", "artifacts/task-evidence/T27/full-gate.txt", "artifacts/task-evidence/T27.json"],
  "redLog": "artifacts/task-evidence/T27/red.txt",
  "greenLog": "artifacts/task-evidence/T27/green.txt",
  "fullGateLog": "artifacts/task-evidence/T27/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T27
python3 scripts/taskctl.py verify-evidence T27
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/pi-adapter/src/message-conversion.ts packages/pi-adapter/src/context-hook.ts tests/contract/pi-context-hook.test.ts apps/pi-context-runtime/src/extension.ts packages/pi-adapter/src/index.ts tests/support/pi.ts artifacts/task-evidence/T27/red.txt artifacts/task-evidence/T27/green.txt artifacts/task-evidence/T27/full-gate.txt artifacts/task-evidence/T27.json
git commit -m "feat(t27): 接入 Pi `context` Hook，处理 Fail-open 宿主与 Safe Abort"
python3 scripts/taskctl.py record-commit T27 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：Pi AgentMessage↔HostMessage conversion
- [ ] 完成：single context handler
- [ ] 完成：hard failure abort+safe view
- [ ] 完成：view receipt staging
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T27` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- contract proves hook before provider conversion
- safe diagnostic is role-valid
- staged view reconciled at assistant/turn boundary

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
