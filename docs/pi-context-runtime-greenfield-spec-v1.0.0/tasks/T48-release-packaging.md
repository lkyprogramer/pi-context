# T48 — 完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W5`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T48` 必须为 `pending` 或已解除 `blocked`  
**目标：** 完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `buildReleaseArtifact`

## 1. 先决条件

- [`T44`](T44-pi-compatibility-ci.md)：必须存在状态 `done` 和 evidence。
- [`T45`](T45-deterministic-mvp-gate.md)：必须存在状态 `done` 和 evidence。
- [`T46`](T46-semantic-beta-gate.md)：必须存在状态 `done` 和 evidence。
- [`T47`](T47-operations-cli.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T44.json, artifacts/task-evidence/T45.json, artifacts/task-evidence/T46.json, artifacts/task-evidence/T47.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T48
python3 scripts/taskctl.py claim T48 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T48: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T48: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`35-pi-package-installation.md`](../35-pi-package-installation.md)
- [`40-release-gates.md`](../40-release-gates.md)

- [`adrs/0021-compat-lock-plus-runtime-probe.md`](../adrs/0021-compat-lock-plus-runtime-probe.md)
- [`adrs/0022-deterministic-mvp-before-semantic.md`](../adrs/0022-deterministic-mvp-before-semantic.md)

## 3. 文件边界

### Create

- scripts/release/build-release.mjs
- scripts/release/verify-release.mjs
- docs/INSTALL.md
- docs/CONFIGURATION.md
- docs/SECURITY.md
- docs/OPERATIONS.md
- docs/COMPATIBILITY.md
- CHANGELOG.md
- tests/release/package-artifact.test.ts

### Modify

- apps/pi-context-runtime/package.json
- README.md

### Tests

- tests/release/package-artifact.test.ts

### Test fixture：Create or Modify

- tests/release/support.ts

### Task Evidence

- artifacts/task-evidence/T48/red.txt
- artifacts/task-evidence/T48/green.txt
- artifacts/task-evidence/T48/full-gate.txt
- artifacts/task-evidence/T48.json

### 唯一允许写入集合

- scripts/release/build-release.mjs
- scripts/release/verify-release.mjs
- docs/INSTALL.md
- docs/CONFIGURATION.md
- docs/SECURITY.md
- docs/OPERATIONS.md
- docs/COMPATIBILITY.md
- CHANGELOG.md
- tests/release/package-artifact.test.ts
- apps/pi-context-runtime/package.json
- README.md
- tests/release/support.ts
- artifacts/task-evidence/T48/red.txt
- artifacts/task-evidence/T48/green.txt
- artifacts/task-evidence/T48/full-gate.txt
- artifacts/task-evidence/T48.json

修改集合外文件时必须停止，并创建 `blockers/T48-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T44 compatibility evidence
- T45/T46 gate decisions
- T47 operations

### Produces

- npm tarball
- SBOM/provenance/manifest
- Pi install guides
- release verification report
- rollback instructions

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 publish without explicit release action
- 不 hide unsupported Pi versions
- 不 ship test secrets/fixtures

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { inspectPackedRelease } from "./support.js";

describe("release package", () => {
  it("contains one extension entry, runtime dependencies and no source-private imports", async () => {
    const artifact = await inspectPackedRelease();
    expect(artifact.piExtensions).toEqual(["./dist/extension.js"]);
    expect(artifact.privatePiImports).toEqual([]);
    expect(artifact.manifestVerified).toBe(true);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T48
set -o pipefail
pnpm vitest run tests/release/package-artifact.test.ts 2>&1 | tee artifacts/task-evidence/T48/red.txt
```

预期：失败原因是本任务主行为 `buildReleaseArtifact` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function buildReleaseArtifact(input: ReleaseInput): Promise<ReleaseReceipt> {
  await assertReleaseGates(input.gateReports);
  const tarball = await npmPack(input.appDir);
  const sbom = await createSbom(tarball);
  const manifest = await hashArtifactSet([tarball, sbom, ...input.docs]);
  await verifyReleaseInCleanPiHome(tarball, input.compatLock);
  return { tarball, sbom, manifest };
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] clean Pi home global/project install
- [ ] temporary `pi -e`
- [ ] uninstall/reinstall
- [ ] Node/OS matrix
- [ ] license/security files
- [ ] deterministic semantic flag default from gate

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/release/package-artifact.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T48/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T48/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T48.json`：

```json
{
  "taskId": "T48",
  "status": "done",
  "allowedFiles": ["scripts/release/build-release.mjs", "scripts/release/verify-release.mjs", "docs/INSTALL.md", "docs/CONFIGURATION.md", "docs/SECURITY.md", "docs/OPERATIONS.md", "docs/COMPATIBILITY.md", "CHANGELOG.md", "tests/release/package-artifact.test.ts", "apps/pi-context-runtime/package.json", "README.md", "tests/release/support.ts", "artifacts/task-evidence/T48/red.txt", "artifacts/task-evidence/T48/green.txt", "artifacts/task-evidence/T48/full-gate.txt", "artifacts/task-evidence/T48.json"],
  "redLog": "artifacts/task-evidence/T48/red.txt",
  "greenLog": "artifacts/task-evidence/T48/green.txt",
  "fullGateLog": "artifacts/task-evidence/T48/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T48
python3 scripts/taskctl.py verify-evidence T48
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add scripts/release/build-release.mjs scripts/release/verify-release.mjs docs/INSTALL.md docs/CONFIGURATION.md docs/SECURITY.md docs/OPERATIONS.md docs/COMPATIBILITY.md CHANGELOG.md tests/release/package-artifact.test.ts apps/pi-context-runtime/package.json README.md tests/release/support.ts artifacts/task-evidence/T48/red.txt artifacts/task-evidence/T48/green.txt artifacts/task-evidence/T48/full-gate.txt artifacts/task-evidence/T48.json
git commit -m "feat(t48): 完成 Release Artifact、文档、SBOM、Manifest 与可复现安装验证"
python3 scripts/taskctl.py record-commit T48 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：npm tarball
- [ ] 完成：SBOM/provenance/manifest
- [ ] 完成：Pi install guides
- [ ] 完成：release verification report
- [ ] 完成：rollback instructions
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T48` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- fresh full check
- tarball content allowlist
- artifact hashes/size/version reported
- install/rollback exact commands

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
