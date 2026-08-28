# T45 — 执行 Deterministic MVP Release Gate 与 Stop/Continue 决策

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W5`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T45` 必须为 `pending` 或已解除 `blocked`  
**目标：** 执行 Deterministic MVP Release Gate 与 Stop/Continue 决策，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `evaluateDeterministicMvpGate`

## 1. 先决条件

- [`T33`](T33-session-lifecycle.md)：必须存在状态 `done` 和 evidence。
- [`T39`](T39-runtime-tools-commands.md)：必须存在状态 `done` 和 evidence。
- [`T40`](T40-package-install-conflicts.md)：必须存在状态 `done` 和 evidence。
- [`T41`](T41-performance-spikes.md)：必须存在状态 `done` 和 evidence。
- [`T42`](T42-benchmark-harness.md)：必须存在状态 `done` 和 evidence。
- [`T43`](T43-security-fuzz.md)：必须存在状态 `done` 和 evidence。
- [`T44`](T44-pi-compatibility-ci.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T33.json, artifacts/task-evidence/T39.json, artifacts/task-evidence/T40.json, artifacts/task-evidence/T41.json, artifacts/task-evidence/T42.json, artifacts/task-evidence/T43.json, artifacts/task-evidence/T44.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T45
python3 scripts/taskctl.py claim T45 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T45: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T45: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`40-release-gates.md`](../40-release-gates.md)
- [`42-roadmap.md`](../42-roadmap.md)

- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)

## 3. 文件边界

### Create

- scripts/gates/deterministic-mvp.mjs
- reports/gates/deterministic-mvp/.gitkeep
- tests/release/deterministic-mvp-gate.test.ts

### Modify

- package.json

### Tests

- tests/release/deterministic-mvp-gate.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T45/red.txt
- artifacts/task-evidence/T45/green.txt
- artifacts/task-evidence/T45/full-gate.txt
- artifacts/task-evidence/T45.json

### 唯一允许写入集合

- scripts/gates/deterministic-mvp.mjs
- reports/gates/deterministic-mvp/.gitkeep
- tests/release/deterministic-mvp-gate.test.ts
- package.json
- artifacts/task-evidence/T45/red.txt
- artifacts/task-evidence/T45/green.txt
- artifacts/task-evidence/T45/full-gate.txt
- artifacts/task-evidence/T45.json

修改集合外文件时必须停止，并创建 `blockers/T45-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T33 deterministic runtime complete
- T39-44 product/perf/benchmark/security/compat evidence

### Produces

- machine-readable MVP gate
- non-inferiority/kill decision
- artifact hash list
- release recommendation

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 implement missing features in gate task
- 不 edit benchmark data
- 不 declare semantic value

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { evaluateDeterministicMvpGate } from "../../scripts/gates/deterministic-mvp.mjs";

describe("deterministic MVP gate", () => {
  it("stops semantic expansion when deterministic net value is non-positive", () => {
    const decision = evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: -0.01 }));
    expect(decision).toMatchObject({ decision: "stop-at-deterministic-slice" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T45
set -o pipefail
pnpm vitest run tests/release/deterministic-mvp-gate.test.ts 2>&1 | tee artifacts/task-evidence/T45/red.txt
```

预期：失败原因是本任务主行为 `evaluateDeterministicMvpGate` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export function evaluateDeterministicMvpGate(evidence: GateEvidence): GateDecision {
  const blockers = checkMvpReleaseCriteria(evidence);
  if (blockers.some((x) => x.kind === "safety" || x.kind === "correctness")) return { decision: "block", blockers };
  if (evidence.realizedNetValue <= 0 || !evidence.taskQualityNonInferior) return { decision: "stop-at-deterministic-slice", blockers };
  return { decision: "proceed-to-semantic-beta", blockers: [] };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] fresh evidence only
- [ ] unsupported Pi versions excluded
- [ ] confidence intervals present
- [ ] known conflicts disclosed
- [ ] manual waiver cannot bypass critical/high

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/release/deterministic-mvp-gate.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T45/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T45/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T45.json`：

```json
{
  "taskId": "T45",
  "status": "done",
  "allowedFiles": ["scripts/gates/deterministic-mvp.mjs", "reports/gates/deterministic-mvp/.gitkeep", "tests/release/deterministic-mvp-gate.test.ts", "package.json", "artifacts/task-evidence/T45/red.txt", "artifacts/task-evidence/T45/green.txt", "artifacts/task-evidence/T45/full-gate.txt", "artifacts/task-evidence/T45.json"],
  "redLog": "artifacts/task-evidence/T45/red.txt",
  "greenLog": "artifacts/task-evidence/T45/green.txt",
  "fullGateLog": "artifacts/task-evidence/T45/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T45
python3 scripts/taskctl.py verify-evidence T45
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add scripts/gates/deterministic-mvp.mjs reports/gates/deterministic-mvp/.gitkeep tests/release/deterministic-mvp-gate.test.ts package.json artifacts/task-evidence/T45/red.txt artifacts/task-evidence/T45/green.txt artifacts/task-evidence/T45/full-gate.txt artifacts/task-evidence/T45.json
git commit -m "feat(t45): 执行 Deterministic MVP Release Gate 与 Stop/Continue 决策"
python3 scripts/taskctl.py record-commit T45 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：machine-readable MVP gate
- [ ] 完成：non-inferiority/kill decision
- [ ] 完成：artifact hash list
- [ ] 完成：release recommendation
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T45` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- signed/hash-indexed report
- clear stop/continue rationale
- deterministic product remains publishable if stopped

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
