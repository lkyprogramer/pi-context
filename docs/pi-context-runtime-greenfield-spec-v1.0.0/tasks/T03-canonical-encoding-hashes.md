# T03 — 实现确定性编码、域隔离哈希、时钟与 ID Provider

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T03` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现确定性编码、域隔离哈希、时钟与 ID Provider，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `domainHash`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T03
python3 scripts/taskctl.py claim T03 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T03: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T03: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`06-host-agnostic-contracts.md`](../06-host-agnostic-contracts.md)
- [`14-saga-and-recovery.md`](../14-saga-and-recovery.md)

- [`adrs/0008-encrypted-content-addressed-blobs.md`](../adrs/0008-encrypted-content-addressed-blobs.md)
- [`adrs/0009-recoverable-saga-not-cross-store-acid.md`](../adrs/0009-recoverable-saga-not-cross-store-acid.md)

## 3. 文件边界

### Create

- packages/contracts/src/canonical.ts
- packages/contracts/src/hash.ts
- packages/contracts/src/providers.ts
- packages/contracts/test/canonical.test.ts

### Modify

- packages/contracts/src/index.ts

### Tests

- packages/contracts/test/canonical.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T03/red.txt
- artifacts/task-evidence/T03/green.txt
- artifacts/task-evidence/T03/full-gate.txt
- artifacts/task-evidence/T03.json

### 唯一允许写入集合

- packages/contracts/src/canonical.ts
- packages/contracts/src/hash.ts
- packages/contracts/src/providers.ts
- packages/contracts/test/canonical.test.ts
- packages/contracts/src/index.ts
- artifacts/task-evidence/T03/red.txt
- artifacts/task-evidence/T03/green.txt
- artifacts/task-evidence/T03/full-gate.txt
- artifacts/task-evidence/T03.json

修改集合外文件时必须停止，并创建 `blockers/T03-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T02 domain types

### Produces

- `canonicalJson`
- `domainHash`
- Clock/IdProvider interfaces
- deterministic test providers

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不实现 encryption
- 不读取 wall clock directly in Kernel
- 不选择 database transaction IDs

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { canonicalJson, domainHash } from "../src/index.js";

describe("canonical hashing", () => {
  it("is key-order invariant and domain separated", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(domainHash("claim", { a: 1 })).not.toBe(domainHash("evidence", { a: 1 }));
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T03
set -o pipefail
pnpm vitest run packages/contracts/test/canonical.test.ts 2>&1 | tee artifacts/task-evidence/T03/red.txt
```

预期：失败原因是本任务主行为 `domainHash` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function domainHash(domain: string, value: unknown): string {
  return createHash("sha256").update(`pcr:${domain}:v1\0`).update(canonicalJson(value)).digest("hex");
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] rejects undefined, bigint, NaN and cyclic inputs
- [ ] same content under different domains has different hashes
- [ ] fake clock and ID provider have no global mutable state

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/contracts/test/canonical.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T03/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T03/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T03.json`：

```json
{
  "taskId": "T03",
  "status": "done",
  "allowedFiles": ["packages/contracts/src/canonical.ts", "packages/contracts/src/hash.ts", "packages/contracts/src/providers.ts", "packages/contracts/test/canonical.test.ts", "packages/contracts/src/index.ts", "artifacts/task-evidence/T03/red.txt", "artifacts/task-evidence/T03/green.txt", "artifacts/task-evidence/T03/full-gate.txt", "artifacts/task-evidence/T03.json"],
  "redLog": "artifacts/task-evidence/T03/red.txt",
  "greenLog": "artifacts/task-evidence/T03/green.txt",
  "fullGateLog": "artifacts/task-evidence/T03/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T03
python3 scripts/taskctl.py verify-evidence T03
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/contracts/src/canonical.ts packages/contracts/src/hash.ts packages/contracts/src/providers.ts packages/contracts/test/canonical.test.ts packages/contracts/src/index.ts artifacts/task-evidence/T03/red.txt artifacts/task-evidence/T03/green.txt artifacts/task-evidence/T03/full-gate.txt artifacts/task-evidence/T03.json
git commit -m "feat(t03): 实现确定性编码、域隔离哈希、时钟与 ID Provider"
python3 scripts/taskctl.py record-commit T03 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：`canonicalJson`
- [ ] 完成：`domainHash`
- [ ] 完成：Clock/IdProvider interfaces
- [ ] 完成：deterministic test providers
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T03` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- byte stability across Node supported matrix
- domain prefix/version is frozen
- all Kernel time/ID dependencies injectable

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
