# T06 — 实现单写 Worker、SQLite Schema 与事务 RPC

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T06` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现单写 Worker、SQLite Schema 与事务 RPC，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `SqliteStore`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。
- [`T03`](T03-canonical-encoding-hashes.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json, artifacts/task-evidence/T03.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T06
python3 scripts/taskctl.py claim T06 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T06: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T06: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`12-storage-engine.md`](../12-storage-engine.md)
- [`11-workspace-session-branch-identity.md`](../11-workspace-session-branch-identity.md)

- [`adrs/0006-physical-workspace-isolation.md`](../adrs/0006-physical-workspace-isolation.md)
- [`adrs/0007-sqlite-single-writer-worker.md`](../adrs/0007-sqlite-single-writer-worker.md)

## 3. 文件边界

### Create

- packages/storage/src/protocol.ts
- packages/storage/src/worker.ts
- packages/storage/src/sqlite-store.ts
- packages/storage/src/schema.sql
- packages/storage/test/sqlite-store.test.ts

### Modify

- packages/storage/package.json

### Tests

- packages/storage/test/sqlite-store.test.ts

### Test fixture：Create or Modify

- packages/storage/test/support.ts

### Task Evidence

- artifacts/task-evidence/T06/red.txt
- artifacts/task-evidence/T06/green.txt
- artifacts/task-evidence/T06/full-gate.txt
- artifacts/task-evidence/T06.json

### 唯一允许写入集合

- packages/storage/src/protocol.ts
- packages/storage/src/worker.ts
- packages/storage/src/sqlite-store.ts
- packages/storage/src/schema.sql
- packages/storage/test/sqlite-store.test.ts
- packages/storage/package.json
- packages/storage/test/support.ts
- artifacts/task-evidence/T06/red.txt
- artifacts/task-evidence/T06/green.txt
- artifacts/task-evidence/T06/full-gate.txt
- artifacts/task-evidence/T06.json

修改集合外文件时必须停止，并创建 `blockers/T06-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T02 IDs/errors
- T03 canonical providers
- reference/schema.sql

### Produces

- typed StorageRpc
- single-writer worker lifecycle
- schema migration and transaction helper
- workspace-scoped DB

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不实现 CAS encryption
- 不运行 FTS query
- 不 expose DatabaseSync outside storage package

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createTestStore } from "./support.js";

describe("SqliteStore", () => {
  const close: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const fn of close.splice(0)) await fn(); });
  it("commits an evidence descriptor atomically", async () => {
    const store = await createTestStore(); close.push(() => store.close());
    await store.transaction(async (tx) => tx.putEvidence({ evidenceId: "ev_aaaaaaaa", contentHash: "a".repeat(64) }));
    expect(await store.getEvidence("ev_aaaaaaaa")).toMatchObject({ contentHash: "a".repeat(64) });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T06
set -o pipefail
pnpm vitest run packages/storage/test/sqlite-store.test.ts 2>&1 | tee artifacts/task-evidence/T06/red.txt
```

预期：失败原因是本任务主行为 `SqliteStore` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export interface StorageRpc {
  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  getEvidence(id: string): Promise<StoredEvidence | null>;
  close(): Promise<void>;
}

export class SqliteStore implements StorageRpc {
  constructor(private readonly db: import("node:sqlite").DatabaseSync) {}
  async transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = await work(new SqliteTransaction(this.db)); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] second writer cannot bypass worker
- [ ] migration crash leaves prior schema readable
- [ ] workspace A cannot query workspace B
- [ ] busy/IO errors become typed PCR errors

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/storage/test/sqlite-store.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T06/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T06/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T06.json`：

```json
{
  "taskId": "T06",
  "status": "done",
  "allowedFiles": ["packages/storage/src/protocol.ts", "packages/storage/src/worker.ts", "packages/storage/src/sqlite-store.ts", "packages/storage/src/schema.sql", "packages/storage/test/sqlite-store.test.ts", "packages/storage/package.json", "packages/storage/test/support.ts", "artifacts/task-evidence/T06/red.txt", "artifacts/task-evidence/T06/green.txt", "artifacts/task-evidence/T06/full-gate.txt", "artifacts/task-evidence/T06.json"],
  "redLog": "artifacts/task-evidence/T06/red.txt",
  "greenLog": "artifacts/task-evidence/T06/green.txt",
  "fullGateLog": "artifacts/task-evidence/T06/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T06
python3 scripts/taskctl.py verify-evidence T06
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/storage/src/protocol.ts packages/storage/src/worker.ts packages/storage/src/sqlite-store.ts packages/storage/src/schema.sql packages/storage/test/sqlite-store.test.ts packages/storage/package.json packages/storage/test/support.ts artifacts/task-evidence/T06/red.txt artifacts/task-evidence/T06/green.txt artifacts/task-evidence/T06/full-gate.txt artifacts/task-evidence/T06.json
git commit -m "feat(t06): 实现单写 Worker、SQLite Schema 与事务 RPC"
python3 scripts/taskctl.py record-commit T06 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：typed StorageRpc
- [ ] 完成：single-writer worker lifecycle
- [ ] 完成：schema migration and transaction helper
- [ ] 完成：workspace-scoped DB
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T06` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- authoritative tables and serving tables distinguished
- full transaction rollback tested
- worker close drains acknowledged writes

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
