# T40 — 实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W4`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T40` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `runRuntimeDoctor`

## 1. 先决条件

- [`T04`](T04-single-extension-orchestrator.md)：必须存在状态 `done` 和 evidence。
- [`T05`](T05-pi-contract-harness.md)：必须存在状态 `done` 和 evidence。
- [`T27`](T27-context-hook-integration.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。
- [`T39`](T39-runtime-tools-commands.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T04.json, artifacts/task-evidence/T05.json, artifacts/task-evidence/T27.json, artifacts/task-evidence/T31.json, artifacts/task-evidence/T39.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T40
python3 scripts/taskctl.py claim T40 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T40: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T40: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`35-pi-package-installation.md`](../35-pi-package-installation.md)
- [`09-single-owner-governance.md`](../09-single-owner-governance.md)

- [`adrs/0003-single-pi-extension-owner.md`](../adrs/0003-single-pi-extension-owner.md)
- [`adrs/0021-compat-lock-plus-runtime-probe.md`](../adrs/0021-compat-lock-plus-runtime-probe.md)

## 3. 文件边界

### Create

- apps/pi-context-runtime/package.json
- apps/pi-context-runtime/src/doctor.ts
- apps/pi-context-runtime/src/conflicts.ts
- apps/pi-context-runtime/test/package-runtime.test.ts
- tests/e2e/packed-install.test.ts

### Modify

- reference/package-blueprint.json

### Tests

- apps/pi-context-runtime/test/package-runtime.test.ts
- tests/e2e/packed-install.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T40/red.txt
- artifacts/task-evidence/T40/green.txt
- artifacts/task-evidence/T40/full-gate.txt
- artifacts/task-evidence/T40.json

### 唯一允许写入集合

- apps/pi-context-runtime/package.json
- apps/pi-context-runtime/src/doctor.ts
- apps/pi-context-runtime/src/conflicts.ts
- apps/pi-context-runtime/test/package-runtime.test.ts
- tests/e2e/packed-install.test.ts
- reference/package-blueprint.json
- artifacts/task-evidence/T40/red.txt
- artifacts/task-evidence/T40/green.txt
- artifacts/task-evidence/T40/full-gate.txt
- artifacts/task-evidence/T40.json

修改集合外文件时必须停止，并创建 `blockers/T40-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T04 owner
- T05 probe
- T27/31 hooks
- T39 commands

### Produces

- publishable Pi package
- known conflict registry
- doctor report
- packed `pi install`/`-e` smoke

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 auto-remove other packages
- 不 claim detecting all conflicts
- 不 pin Pi core peer away from Pi package guidance

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { runRuntimeDoctor } from "../src/doctor.js";

describe("runtime doctor", () => {
  it("blocks strict activation when a known context owner is installed", async () => {
    const report = await runRuntimeDoctor(fixtureEnvironment({ packages: ["billion-context-pi"] }), { conflictPolicy: "strict" });
    expect(report.ready).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "PCR_KNOWN_CONTEXT_CONFLICT" }));
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T40
set -o pipefail
pnpm vitest run apps/pi-context-runtime/test/package-runtime.test.ts tests/e2e/packed-install.test.ts 2>&1 | tee artifacts/task-evidence/T40/red.txt
```

预期：失败原因是本任务主行为 `runRuntimeDoctor` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function runRuntimeDoctor(env: DoctorEnvironment, config: DoctorConfig): Promise<DoctorReport> {
  const findings = [
    ...checkNodeAndPiVersion(env), ...checkRequiredCapabilities(env),
    ...checkKnownOwnerConflicts(env.packages), ...await checkStorageAndKeys(env),
    ...checkDiskAndPermissions(env)
  ];
  return { ready: findings.every((x) => x.severity !== "blocking"), findings };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] npm production install includes runtime deps
- [ ] one extension entry
- [ ] project trust respected
- [ ] unknown plugin limitation printed
- [ ] no private Pi imports in packed JS

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run apps/pi-context-runtime/test/package-runtime.test.ts tests/e2e/packed-install.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T40/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T40/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T40.json`：

```json
{
  "taskId": "T40",
  "status": "done",
  "allowedFiles": ["apps/pi-context-runtime/package.json", "apps/pi-context-runtime/src/doctor.ts", "apps/pi-context-runtime/src/conflicts.ts", "apps/pi-context-runtime/test/package-runtime.test.ts", "tests/e2e/packed-install.test.ts", "reference/package-blueprint.json", "artifacts/task-evidence/T40/red.txt", "artifacts/task-evidence/T40/green.txt", "artifacts/task-evidence/T40/full-gate.txt", "artifacts/task-evidence/T40.json"],
  "redLog": "artifacts/task-evidence/T40/red.txt",
  "greenLog": "artifacts/task-evidence/T40/green.txt",
  "fullGateLog": "artifacts/task-evidence/T40/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T40
python3 scripts/taskctl.py verify-evidence T40
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add apps/pi-context-runtime/package.json apps/pi-context-runtime/src/doctor.ts apps/pi-context-runtime/src/conflicts.ts apps/pi-context-runtime/test/package-runtime.test.ts tests/e2e/packed-install.test.ts reference/package-blueprint.json artifacts/task-evidence/T40/red.txt artifacts/task-evidence/T40/green.txt artifacts/task-evidence/T40/full-gate.txt artifacts/task-evidence/T40.json
git commit -m "feat(t40): 实现 Pi Package 安装、Runtime Doctor 与 Known Owner Conflict 管理"
python3 scripts/taskctl.py record-commit T40 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：publishable Pi package
- [ ] 完成：known conflict registry
- [ ] 完成：doctor report
- [ ] 完成：packed `pi install`/`-e` smoke
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T40` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- pi install and temporary -e tested
- strict/warn/off conflict modes
- doctor output contains no secrets/absolute paths

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
