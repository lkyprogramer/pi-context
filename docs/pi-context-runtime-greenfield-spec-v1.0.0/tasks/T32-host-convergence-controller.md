# T32 — 实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T32` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `decideHostConvergence`

## 1. 先决条件

- [`T24`](T24-token-accounting.md)：必须存在状态 `done` 和 evidence。
- [`T27`](T27-context-hook-integration.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T24.json, artifacts/task-evidence/T27.json, artifacts/task-evidence/T31.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T32
python3 scripts/taskctl.py claim T32 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T32: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T32: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`25-pi-context-hook.md`](../25-pi-context-hook.md)
- [`39-performance-slo.md`](../39-performance-slo.md)

- [`adrs/0002-hybrid-request-view-and-host-compaction.md`](../adrs/0002-hybrid-request-view-and-host-compaction.md)
- [`adrs/0017-pi-native-compaction-as-host-convergence.md`](../adrs/0017-pi-native-compaction-as-host-convergence.md)

## 3. 文件边界

### Create

- packages/kernel/src/control/convergence.ts
- packages/pi-adapter/src/convergence-controller.ts
- packages/kernel/test/convergence.test.ts

### Modify

- packages/kernel/src/index.ts

### Tests

- packages/kernel/test/convergence.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T32/red.txt
- artifacts/task-evidence/T32/green.txt
- artifacts/task-evidence/T32/full-gate.txt
- artifacts/task-evidence/T32.json

### 唯一允许写入集合

- packages/kernel/src/control/convergence.ts
- packages/pi-adapter/src/convergence-controller.ts
- packages/kernel/test/convergence.test.ts
- packages/kernel/src/index.ts
- artifacts/task-evidence/T32/red.txt
- artifacts/task-evidence/T32/green.txt
- artifacts/task-evidence/T32/full-gate.txt
- artifacts/task-evidence/T32.json

修改集合外文件时必须停止，并创建 `blockers/T32-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T24 pressure/growth
- T27 context metrics
- T31 `ctx.compact()` integration

### Produces

- convergence decision
- message-count/clone-latency/pressure triggers
- settled-boundary compaction request
- growth hysteresis

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 mutate Pi agent state directly
- 不 use fixed token threshold alone
- 不 start background work in extension factory

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { decideHostConvergence } from "../src/control/convergence.js";

describe("host convergence", () => {
  it("compacts before full-history clone cost becomes unbounded", () => {
    const decision = decideHostConvergence({ messageCount: 1200, cloneP95Ms: 95, pressure: 0.52, grewSinceLast: 400 }, balancedPolicy());
    expect(decision).toMatchObject({ kind: "compact", reason: "clone-cost" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T32
set -o pipefail
pnpm vitest run packages/kernel/test/convergence.test.ts 2>&1 | tee artifacts/task-evidence/T32/red.txt
```

预期：失败原因是本任务主行为 `decideHostConvergence` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function decideHostConvergence(metrics: HostMetrics, policy: ConvergencePolicy): ConvergenceDecision {
  if (metrics.pressure >= policy.hardRatio) return { kind: "compact", reason: "hard-pressure" };
  if (metrics.messageCount >= policy.maxHostMessages || metrics.cloneP95Ms >= policy.maxCloneP95Ms) return { kind: "compact", reason: "clone-cost" };
  if (metrics.pressure >= policy.softRatio && metrics.grewSinceLast >= policy.minGrowth && metrics.atBoundary) return { kind: "compact", reason: "soft-pressure" };
  return { kind: "defer" };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] never compact while streaming/mid-tool
- [ ] cooldown and minimum growth
- [ ] queued message defers unless overflow
- [ ] compaction failure falls back without loop

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/convergence.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T32/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T32/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T32.json`：

```json
{
  "taskId": "T32",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/control/convergence.ts", "packages/pi-adapter/src/convergence-controller.ts", "packages/kernel/test/convergence.test.ts", "packages/kernel/src/index.ts", "artifacts/task-evidence/T32/red.txt", "artifacts/task-evidence/T32/green.txt", "artifacts/task-evidence/T32/full-gate.txt", "artifacts/task-evidence/T32.json"],
  "redLog": "artifacts/task-evidence/T32/red.txt",
  "greenLog": "artifacts/task-evidence/T32/green.txt",
  "fullGateLog": "artifacts/task-evidence/T32/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T32
python3 scripts/taskctl.py verify-evidence T32
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/control/convergence.ts packages/pi-adapter/src/convergence-controller.ts packages/kernel/test/convergence.test.ts packages/kernel/src/index.ts artifacts/task-evidence/T32/red.txt artifacts/task-evidence/T32/green.txt artifacts/task-evidence/T32/full-gate.txt artifacts/task-evidence/T32.json
git commit -m "feat(t32): 实现周期性 Pi Host 收敛策略与 Clone-cost Backpressure"
python3 scripts/taskctl.py record-commit T32 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：convergence decision
- [ ] 完成：message-count/clone-latency/pressure triggers
- [ ] 完成：settled-boundary compaction request
- [ ] 完成：growth hysteresis
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T32` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- host message count remains bounded in soak test
- trigger reasons observable
- no repeated no-progress compaction

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
