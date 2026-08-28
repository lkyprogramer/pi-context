# T02 — 实现唯一 Canonical Type、ID 与错误词汇

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T02` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现唯一 Canonical Type、ID 与错误词汇，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `SourceClass`

## 1. 先决条件

- [`T01`](T01-workspace-scaffold.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T01.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T02
python3 scripts/taskctl.py claim T02 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T02: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T02: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`06-host-agnostic-contracts.md`](../06-host-agnostic-contracts.md)
- [`10-authorities-and-trust-boundaries.md`](../10-authorities-and-trust-boundaries.md)

- [`adrs/0005-dual-authority-boundary.md`](../adrs/0005-dual-authority-boundary.md)
- [`adrs/0012-authority-bound-provenance.md`](../adrs/0012-authority-bound-provenance.md)

## 3. 文件边界

### Create

- packages/contracts/src/types.ts
- packages/contracts/src/errors.ts
- packages/contracts/src/ids.ts
- packages/contracts/src/index.ts
- packages/contracts/test/types.test.ts

### Modify

- packages/contracts/package.json

### Tests

- packages/contracts/test/types.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T02/red.txt
- artifacts/task-evidence/T02/green.txt
- artifacts/task-evidence/T02/full-gate.txt
- artifacts/task-evidence/T02.json

### 唯一允许写入集合

- packages/contracts/src/types.ts
- packages/contracts/src/errors.ts
- packages/contracts/src/ids.ts
- packages/contracts/src/index.ts
- packages/contracts/test/types.test.ts
- packages/contracts/package.json
- artifacts/task-evidence/T02/red.txt
- artifacts/task-evidence/T02/green.txt
- artifacts/task-evidence/T02/full-gate.txt
- artifacts/task-evidence/T02.json

修改集合外文件时必须停止，并创建 `blockers/T02-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T01 workspace exports

### Produces

- SourceClass/ActionAuthority/HostMessage 等公开类型
- `PcrError` 判别联合
- 域隔离 branded ID constructors

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不实现 canonical hash
- 不定义 Pi AgentMessage conversion
- 不实现数据库模型

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { actionAuthorityRank, sourceAuthorityCeiling } from "../src/index.js";

describe("authority vocabulary", () => {
  it("keeps source identity separate from action authority", () => {
    expect(sourceAuthorityCeiling("agent-derived")).toBe("propose");
    expect(sourceAuthorityCeiling("untrusted-tool")).toBe("inform");
    expect(actionAuthorityRank("act")).toBeGreaterThan(actionAuthorityRank("propose"));
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T02
set -o pipefail
pnpm vitest run packages/contracts/test/types.test.ts 2>&1 | tee artifacts/task-evidence/T02/red.txt
```

预期：失败原因是本任务主行为 `SourceClass` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export type SourceClass =
  | "system" | "authenticated-user" | "untrusted-user"
  | "trusted-tool" | "untrusted-tool" | "external-content" | "agent-derived";

export type ActionAuthority = "none" | "inform" | "propose" | "act";

const RANK: Record<ActionAuthority, number> = { none: 0, inform: 1, propose: 2, act: 3 };
export const actionAuthorityRank = (value: ActionAuthority): number => RANK[value];
export function sourceAuthorityCeiling(source: SourceClass): ActionAuthority {
  if (source === "system" || source === "authenticated-user" || source === "trusted-tool") return "act";
  if (source === "agent-derived") return "propose";
  if (source === "untrusted-user" || source === "untrusted-tool" || source === "external-content") return "inform";
  return "none";
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] unknown source value is rejected by runtime parser
- [ ] derived object authority cannot exceed minimum support ceiling
- [ ] error handling uses `code`, never message substring matching

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/contracts/test/types.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T02/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T02/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T02.json`：

```json
{
  "taskId": "T02",
  "status": "done",
  "allowedFiles": ["packages/contracts/src/types.ts", "packages/contracts/src/errors.ts", "packages/contracts/src/ids.ts", "packages/contracts/src/index.ts", "packages/contracts/test/types.test.ts", "packages/contracts/package.json", "artifacts/task-evidence/T02/red.txt", "artifacts/task-evidence/T02/green.txt", "artifacts/task-evidence/T02/full-gate.txt", "artifacts/task-evidence/T02.json"],
  "redLog": "artifacts/task-evidence/T02/red.txt",
  "greenLog": "artifacts/task-evidence/T02/green.txt",
  "fullGateLog": "artifacts/task-evidence/T02/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T02
python3 scripts/taskctl.py verify-evidence T02
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/contracts/src/types.ts packages/contracts/src/errors.ts packages/contracts/src/ids.ts packages/contracts/src/index.ts packages/contracts/test/types.test.ts packages/contracts/package.json artifacts/task-evidence/T02/red.txt artifacts/task-evidence/T02/green.txt artifacts/task-evidence/T02/full-gate.txt artifacts/task-evidence/T02.json
git commit -m "feat(t02): 实现唯一 Canonical Type、ID 与错误词汇"
python3 scripts/taskctl.py record-commit T02 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：SourceClass/ActionAuthority/HostMessage 等公开类型
- [ ] 完成：`PcrError` 判别联合
- [ ] 完成：域隔离 branded ID constructors
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T02` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- 06 文档中同名接口只在 contracts 定义
- SourceClass 与 ActionAuthority 不混用
- 所有 ID 使用 branded types

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
