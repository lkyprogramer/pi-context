# T44 — 实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W4`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T44` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `verifyPiCompatibility`

## 1. 先决条件

- [`T05`](T05-pi-contract-harness.md)：必须存在状态 `done` 和 evidence。
- [`T27`](T27-context-hook-integration.md)：必须存在状态 `done` 和 evidence。
- [`T31`](T31-compaction-takeover.md)：必须存在状态 `done` 和 evidence。
- [`T40`](T40-package-install-conflicts.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T05.json, artifacts/task-evidence/T27.json, artifacts/task-evidence/T31.json, artifacts/task-evidence/T40.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T44
python3 scripts/taskctl.py claim T44 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T44: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T44: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`36-compatibility-versioning.md`](../36-compatibility-versioning.md)
- [`07-pi-public-api-mapping.md`](../07-pi-public-api-mapping.md)

- [`adrs/0004-public-pi-api-only.md`](../adrs/0004-public-pi-api-only.md)
- [`adrs/0021-compat-lock-plus-runtime-probe.md`](../adrs/0021-compat-lock-plus-runtime-probe.md)

## 3. 文件边界

### Create

- scripts/install-pi-version.mjs
- scripts/check-public-pi-imports.mjs
- tests/compat/pi-version-contract.test.ts
- tests/compat/provider-payload-probe.test.ts
- .github/workflows/compatibility.yml
- compat/pi.lock.json

### Modify

- package.json
- reference/ci-matrix.yml

### Tests

- tests/compat/pi-version-contract.test.ts
- tests/compat/provider-payload-probe.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T44/red.txt
- artifacts/task-evidence/T44/green.txt
- artifacts/task-evidence/T44/full-gate.txt
- artifacts/task-evidence/T44.json

### 唯一允许写入集合

- scripts/install-pi-version.mjs
- scripts/check-public-pi-imports.mjs
- tests/compat/pi-version-contract.test.ts
- tests/compat/provider-payload-probe.test.ts
- .github/workflows/compatibility.yml
- compat/pi.lock.json
- package.json
- reference/ci-matrix.yml
- artifacts/task-evidence/T44/red.txt
- artifacts/task-evidence/T44/green.txt
- artifacts/task-evidence/T44/full-gate.txt
- artifacts/task-evidence/T44.json

修改集合外文件时必须停止，并创建 `blockers/T44-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T05 contract harness
- T27/31 hooks
- T40 packed package

### Produces

- min/current/latest compatibility jobs
- public import scanner
- runtime capability probe
- supported provider payload hash diagnostic
- compat lock updater

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 import private Pi internals
- 不 monkeypatch ExtensionRunner
- 不 use `*` runtime support claim without passing matrix

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { scanImports } from "../../scripts/check-public-pi-imports.mjs";

describe("Pi public API boundary", () => {
  it("rejects source-path and unexported Pi imports", async () => {
    const findings = await scanImports(["packages/pi-adapter", "apps/pi-context-runtime"]);
    expect(findings).toEqual([]);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T44
set -o pipefail
pnpm vitest run tests/compat/pi-version-contract.test.ts tests/compat/provider-payload-probe.test.ts 2>&1 | tee artifacts/task-evidence/T44/red.txt
```

预期：失败原因是本任务主行为 `verifyPiCompatibility` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function verifyPiCompatibility(version: string, harness: PiContractHarness): Promise<CompatibilityReport> {
  const capabilities = await harness.probeCapabilities();
  const contracts = await runPiContractSuite(harness);
  return { version, ready: capabilities.ready && contracts.every((x) => x.ok), capabilities, contracts };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] Pi handler chaining/fail-open unchanged
- [ ] custom entry excluded
- [ ] compaction commit order
- [ ] TUI/RPC/print
- [ ] model/tree changes
- [ ] unsupported payload probe reports unavailable

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/compat/pi-version-contract.test.ts tests/compat/provider-payload-probe.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T44/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T44/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T44.json`：

```json
{
  "taskId": "T44",
  "status": "done",
  "allowedFiles": ["scripts/install-pi-version.mjs", "scripts/check-public-pi-imports.mjs", "tests/compat/pi-version-contract.test.ts", "tests/compat/provider-payload-probe.test.ts", ".github/workflows/compatibility.yml", "compat/pi.lock.json", "package.json", "reference/ci-matrix.yml", "artifacts/task-evidence/T44/red.txt", "artifacts/task-evidence/T44/green.txt", "artifacts/task-evidence/T44/full-gate.txt", "artifacts/task-evidence/T44.json"],
  "redLog": "artifacts/task-evidence/T44/red.txt",
  "greenLog": "artifacts/task-evidence/T44/green.txt",
  "fullGateLog": "artifacts/task-evidence/T44/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T44
python3 scripts/taskctl.py verify-evidence T44
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add scripts/install-pi-version.mjs scripts/check-public-pi-imports.mjs tests/compat/pi-version-contract.test.ts tests/compat/provider-payload-probe.test.ts .github/workflows/compatibility.yml compat/pi.lock.json package.json reference/ci-matrix.yml artifacts/task-evidence/T44/red.txt artifacts/task-evidence/T44/green.txt artifacts/task-evidence/T44/full-gate.txt artifacts/task-evidence/T44.json
git commit -m "feat(t44): 实现 Pi 版本矩阵、Public-import Scan、Runtime Probe 与 Payload Integrity Diagnostics"
python3 scripts/taskctl.py record-commit T44 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：min/current/latest compatibility jobs
- [ ] 完成：public import scanner
- [ ] 完成：runtime capability probe
- [ ] 完成：supported provider payload hash diagnostic
- [ ] 完成：compat lock updater
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T44` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- compat lock exact evidence
- packed app against installed Pi
- upgrade failure blocks release not user data

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
