# T17 — 实现 Literal/Path/Error/Command 倒排索引与时间过滤

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W1`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T17` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Literal/Path/Error/Command 倒排索引与时间过滤，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `LiteralIndex`

## 1. 先决条件

- [`T15`](T15-evidence-units.md)：必须存在状态 `done` 和 evidence。
- [`T06`](T06-sqlite-store.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T15.json, artifacts/task-evidence/T06.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T17
python3 scripts/taskctl.py claim T17 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T17: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T17: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`21-catalog-and-retrieval.md`](../21-catalog-and-retrieval.md)
- [`18-evidence-model.md`](../18-evidence-model.md)

- [`adrs/0013-exact-first-retrieval.md`](../adrs/0013-exact-first-retrieval.md)
- [`adrs/0020-no-embedding-in-v1-correctness.md`](../adrs/0020-no-embedding-in-v1-correctness.md)

## 3. 文件边界

### Create

- packages/kernel/src/retrieval/literal-index.ts
- packages/kernel/src/retrieval/normalizers.ts
- packages/kernel/test/literal-index.test.ts

### Modify

- packages/storage/src/protocol.ts

### Tests

- packages/kernel/test/literal-index.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T17/red.txt
- artifacts/task-evidence/T17/green.txt
- artifacts/task-evidence/T17/full-gate.txt
- artifacts/task-evidence/T17.json

### 唯一允许写入集合

- packages/kernel/src/retrieval/literal-index.ts
- packages/kernel/src/retrieval/normalizers.ts
- packages/kernel/test/literal-index.test.ts
- packages/storage/src/protocol.ts
- artifacts/task-evidence/T17/red.txt
- artifacts/task-evidence/T17/green.txt
- artifacts/task-evidence/T17/full-gate.txt
- artifacts/task-evidence/T17.json

修改集合外文件时必须停止，并创建 `blockers/T17-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T15 EvidenceUnit
- T06 serving index transaction

### Produces

- literal/path/error/command indexes
- timestamp/status/source/authority filters
- deterministic rank

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 use embeddings
- 不 infer semantic synonym
- 不 expose global document frequency across workspaces

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { LiteralIndex } from "../src/retrieval/literal-index.js";

describe("literal index", () => {
  it("keeps same basenames distinct and filters superseded evidence", async () => {
    const index = await LiteralIndex.inMemory();
    await index.upsert(fixtureEvidence("src/a/config.ts", "active"));
    await index.upsert(fixtureEvidence("test/config.ts", "superseded"));
    const hits = await index.search({ literal: "config.ts", statuses: ["active"] });
    expect(hits.map((x) => x.path)).toEqual(["src/a/config.ts"]);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T17
set -o pipefail
pnpm vitest run packages/kernel/test/literal-index.test.ts 2>&1 | tee artifacts/task-evidence/T17/red.txt
```

预期：失败原因是本任务主行为 `LiteralIndex` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export class LiteralIndex {
  async search(query: LiteralSearchQuery): Promise<RetrievalHit[]> {
    const tokens = normalizeExactTokens(query.literal);
    const candidates = await this.store.lookupLiteralTokens(tokens, query.filters);
    return candidates.sort((a, b) => compareTuple([b.exactness, b.recency, b.authorityRank, a.evidenceId], [a.exactness, a.recency, a.authorityRank, b.evidenceId]));
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] CJK tokenization
- [ ] case-sensitive identifiers plus optional folded path search
- [ ] no arbitrary regex from model
- [ ] query timeout/cancellation respected

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/literal-index.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T17/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T17/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T17.json`：

```json
{
  "taskId": "T17",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/retrieval/literal-index.ts", "packages/kernel/src/retrieval/normalizers.ts", "packages/kernel/test/literal-index.test.ts", "packages/storage/src/protocol.ts", "artifacts/task-evidence/T17/red.txt", "artifacts/task-evidence/T17/green.txt", "artifacts/task-evidence/T17/full-gate.txt", "artifacts/task-evidence/T17.json"],
  "redLog": "artifacts/task-evidence/T17/red.txt",
  "greenLog": "artifacts/task-evidence/T17/green.txt",
  "fullGateLog": "artifacts/task-evidence/T17/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T17
python3 scripts/taskctl.py verify-evidence T17
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/retrieval/literal-index.ts packages/kernel/src/retrieval/normalizers.ts packages/kernel/test/literal-index.test.ts packages/storage/src/protocol.ts artifacts/task-evidence/T17/red.txt artifacts/task-evidence/T17/green.txt artifacts/task-evidence/T17/full-gate.txt artifacts/task-evidence/T17.json
git commit -m "feat(t17): 实现 Literal/Path/Error/Command 倒排索引与时间过滤"
python3 scripts/taskctl.py record-commit T17 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：literal/path/error/command indexes
- [ ] 完成：timestamp/status/source/authority filters
- [ ] 完成：deterministic rank
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T17` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- deterministic ordering with tie-break ID
- status/time/source filters mandatory
- index rebuildable from canonical evidence

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
