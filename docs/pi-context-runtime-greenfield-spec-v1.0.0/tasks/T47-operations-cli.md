# T47 — 实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W5`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T47` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `createWorkspaceBackup`

## 1. 先决条件

- [`T06`](T06-sqlite-store.md)：必须存在状态 `done` 和 evidence。
- [`T07`](T07-encrypted-blob-cas.md)：必须存在状态 `done` 和 evidence。
- [`T08`](T08-saga-recovery.md)：必须存在状态 `done` 和 evidence。
- [`T40`](T40-package-install-conflicts.md)：必须存在状态 `done` 和 evidence。
- [`T45`](T45-deterministic-mvp-gate.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T06.json, artifacts/task-evidence/T07.json, artifacts/task-evidence/T08.json, artifacts/task-evidence/T40.json, artifacts/task-evidence/T45.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T47
python3 scripts/taskctl.py claim T47 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T47: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T47: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`41-operations-and-troubleshooting.md`](../41-operations-and-troubleshooting.md)
- [`13-blob-cas-and-key-management.md`](../13-blob-cas-and-key-management.md)

- [`adrs/0006-physical-workspace-isolation.md`](../adrs/0006-physical-workspace-isolation.md)
- [`adrs/0008-encrypted-content-addressed-blobs.md`](../adrs/0008-encrypted-content-addressed-blobs.md)

## 3. 文件边界

### Create

- packages/storage/src/operations/backup.ts
- packages/storage/src/operations/restore.ts
- packages/storage/src/operations/gc.ts
- packages/storage/src/operations/key-rotation.ts
- apps/pi-context-runtime/src/commands/operations.ts
- tests/e2e/operations.test.ts

### Modify

- apps/pi-context-runtime/src/extension.ts

### Tests

- tests/e2e/operations.test.ts

### Test fixture：Create or Modify

- tests/e2e/support.ts

### Task Evidence

- artifacts/task-evidence/T47/red.txt
- artifacts/task-evidence/T47/green.txt
- artifacts/task-evidence/T47/full-gate.txt
- artifacts/task-evidence/T47.json

### 唯一允许写入集合

- packages/storage/src/operations/backup.ts
- packages/storage/src/operations/restore.ts
- packages/storage/src/operations/gc.ts
- packages/storage/src/operations/key-rotation.ts
- apps/pi-context-runtime/src/commands/operations.ts
- tests/e2e/operations.test.ts
- apps/pi-context-runtime/src/extension.ts
- tests/e2e/support.ts
- artifacts/task-evidence/T47/red.txt
- artifacts/task-evidence/T47/green.txt
- artifacts/task-evidence/T47/full-gate.txt
- artifacts/task-evidence/T47.json

修改集合外文件时必须停止，并创建 `blockers/T47-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T06 store
- T07 CAS/key
- T08 recovery
- T40 doctor
- T45 gate

### Produces

- workspace backup/restore format
- dry-run/commit GC
- online/offline key rotation
- recovery/doctor commands

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 upload remotely
- 不 delete live data without explicit commit
- 不 mix workspaces

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { operationsFixture } from "./support.js";

describe("operations", () => {
  it("restores into a new empty directory and verifies every manifest hash", async () => {
    const fx = await operationsFixture();
    const archive = await fx.backup();
    const restored = await fx.restoreToNewDirectory(archive);
    expect(restored.verified).toBe(true);
    expect(restored.contextHead).toBe(fx.originalContextHead);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T47
set -o pipefail
pnpm vitest run tests/e2e/operations.test.ts 2>&1 | tee artifacts/task-evidence/T47/red.txt
```

预期：失败原因是本任务主行为 `createWorkspaceBackup` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function createWorkspaceBackup(input: BackupInput, deps: OperationDeps): Promise<BackupReceipt> {
  await deps.store.checkpoint();
  const manifest = await buildBackupManifest(input.workspaceRoot, deps);
  const archive = await writeEncryptedArchive(manifest, deps.backupKey);
  await verifyArchive(archive, manifest);
  return { archive, manifestHash: domainHash("backup-manifest", manifest) };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] restore never overwrites live directory
- [ ] GC dry-run exact
- [ ] referenced blobs protected
- [ ] rotation crash resumes old/new key sets
- [ ] backup excludes plaintext secrets

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/e2e/operations.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T47/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T47/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T47.json`：

```json
{
  "taskId": "T47",
  "status": "done",
  "allowedFiles": ["packages/storage/src/operations/backup.ts", "packages/storage/src/operations/restore.ts", "packages/storage/src/operations/gc.ts", "packages/storage/src/operations/key-rotation.ts", "apps/pi-context-runtime/src/commands/operations.ts", "tests/e2e/operations.test.ts", "apps/pi-context-runtime/src/extension.ts", "tests/e2e/support.ts", "artifacts/task-evidence/T47/red.txt", "artifacts/task-evidence/T47/green.txt", "artifacts/task-evidence/T47/full-gate.txt", "artifacts/task-evidence/T47.json"],
  "redLog": "artifacts/task-evidence/T47/red.txt",
  "greenLog": "artifacts/task-evidence/T47/green.txt",
  "fullGateLog": "artifacts/task-evidence/T47/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T47
python3 scripts/taskctl.py verify-evidence T47
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/storage/src/operations/backup.ts packages/storage/src/operations/restore.ts packages/storage/src/operations/gc.ts packages/storage/src/operations/key-rotation.ts apps/pi-context-runtime/src/commands/operations.ts tests/e2e/operations.test.ts apps/pi-context-runtime/src/extension.ts tests/e2e/support.ts artifacts/task-evidence/T47/red.txt artifacts/task-evidence/T47/green.txt artifacts/task-evidence/T47/full-gate.txt artifacts/task-evidence/T47.json
git commit -m "feat(t47): 实现 Doctor、Recovery、Backup/Restore、GC、Key Rotation 运维工具"
python3 scripts/taskctl.py record-commit T47 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：workspace backup/restore format
- [ ] 完成：dry-run/commit GC
- [ ] 完成：online/offline key rotation
- [ ] 完成：recovery/doctor commands
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T47` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- recovery drill documented
- manifests canonical
- operations available without LLM

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
