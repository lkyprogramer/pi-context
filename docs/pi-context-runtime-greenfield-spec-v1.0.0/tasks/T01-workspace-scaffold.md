# T01 — 创建 Monorepo、包边界与基础 CI

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T01` 必须为 `pending` 或已解除 `blocked`  
**目标：** 创建 Monorepo、包边界与基础 CI，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `assertWorkspaceLayout`

## 1. 先决条件

- 无；这是根任务。

依赖 Evidence：`无`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T01
python3 scripts/taskctl.py claim T01 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T01: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T01: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`05-repository-and-package-layout.md`](../05-repository-and-package-layout.md)
- [`44-ai-agent-execution-protocol.md`](../44-ai-agent-execution-protocol.md)

- [`adrs/0001-host-agnostic-kernel-pi-first.md`](../adrs/0001-host-agnostic-kernel-pi-first.md)
- [`adrs/0004-public-pi-api-only.md`](../adrs/0004-public-pi-api-only.md)

## 3. 文件边界

### Create

- package.json
- pnpm-workspace.yaml
- tsconfig.base.json
- vitest.workspace.ts
- .npmrc
- .gitignore
- scripts/check-package-boundaries.mjs
- apps/pi-context-runtime/package.json
- packages/contracts/package.json
- packages/kernel/package.json
- packages/storage/package.json
- packages/worker/package.json
- packages/pi-adapter/package.json
- packages/testkit/package.json
- tests/meta/workspace-layout.test.ts

### Modify

- 无

### Tests

- tests/meta/workspace-layout.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T01/red.txt
- artifacts/task-evidence/T01/green.txt
- artifacts/task-evidence/T01/full-gate.txt
- artifacts/task-evidence/T01.json

### 唯一允许写入集合

- package.json
- pnpm-workspace.yaml
- tsconfig.base.json
- vitest.workspace.ts
- .npmrc
- .gitignore
- scripts/check-package-boundaries.mjs
- apps/pi-context-runtime/package.json
- packages/contracts/package.json
- packages/kernel/package.json
- packages/storage/package.json
- packages/worker/package.json
- packages/pi-adapter/package.json
- packages/testkit/package.json
- tests/meta/workspace-layout.test.ts
- artifacts/task-evidence/T01/red.txt
- artifacts/task-evidence/T01/green.txt
- artifacts/task-evidence/T01/full-gate.txt
- artifacts/task-evidence/T01.json

修改集合外文件时必须停止，并创建 `blockers/T01-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- 无

### Produces

- 根脚本 `check:boundaries`, `typecheck`, `test`, `check:all`
- 七个 workspace package manifests
- 包边界扫描器

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不实现领域类型
- 不安装 SQLite schema
- 不注册真实 Pi Hook

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("workspace layout", () => {
  it("declares every frozen package and one Pi extension entry", () => {
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    for (const path of ["apps/*", "packages/*"]) expect(workspace).toContain(path);
    for (const dir of ["contracts","kernel","storage","worker","pi-adapter","testkit"]) {
      expect(existsSync(`packages/${dir}/package.json`)).toBe(true);
    }
    const app = JSON.parse(readFileSync("apps/pi-context-runtime/package.json", "utf8"));
    expect(app.pi.extensions).toEqual(["./dist/extension.js"]);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T01
set -o pipefail
pnpm vitest run tests/meta/workspace-layout.test.ts 2>&1 | tee artifacts/task-evidence/T01/red.txt
```

预期：失败原因是本任务主行为 `assertWorkspaceLayout` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```json
{
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "check:boundaries": "node scripts/check-package-boundaries.mjs",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run --workspace vitest.workspace.ts",
    "check:all": "pnpm check:boundaries && pnpm typecheck && pnpm test"
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] 边界扫描器拒绝 `packages/kernel` 导入 `@earendil-works/*`
- [ ] 最终 app manifest 含两个 extension entry 时测试失败
- [ ] 工作区 package 缺失时测试失败

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run tests/meta/workspace-layout.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T01/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T01/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T01.json`：

```json
{
  "taskId": "T01",
  "status": "done",
  "allowedFiles": ["package.json", "pnpm-workspace.yaml", "tsconfig.base.json", "vitest.workspace.ts", ".npmrc", ".gitignore", "scripts/check-package-boundaries.mjs", "apps/pi-context-runtime/package.json", "packages/contracts/package.json", "packages/kernel/package.json", "packages/storage/package.json", "packages/worker/package.json", "packages/pi-adapter/package.json", "packages/testkit/package.json", "tests/meta/workspace-layout.test.ts", "artifacts/task-evidence/T01/red.txt", "artifacts/task-evidence/T01/green.txt", "artifacts/task-evidence/T01/full-gate.txt", "artifacts/task-evidence/T01.json"],
  "redLog": "artifacts/task-evidence/T01/red.txt",
  "greenLog": "artifacts/task-evidence/T01/green.txt",
  "fullGateLog": "artifacts/task-evidence/T01/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T01
python3 scripts/taskctl.py verify-evidence T01
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts .npmrc .gitignore scripts/check-package-boundaries.mjs apps/pi-context-runtime/package.json packages/contracts/package.json packages/kernel/package.json packages/storage/package.json packages/worker/package.json packages/pi-adapter/package.json packages/testkit/package.json tests/meta/workspace-layout.test.ts artifacts/task-evidence/T01/red.txt artifacts/task-evidence/T01/green.txt artifacts/task-evidence/T01/full-gate.txt artifacts/task-evidence/T01.json
git commit -m "feat(t01): 创建 Monorepo、包边界与基础 CI"
python3 scripts/taskctl.py record-commit T01 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：根脚本 `check:boundaries`, `typecheck`, `test`, `check:all`
- [ ] 完成：七个 workspace package manifests
- [ ] 完成：包边界扫描器
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T01` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- 依赖方向与 05 文档一致
- 最终包只有一个 Extension entry
- 根脚本可在空实现上运行

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
