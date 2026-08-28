# T20 — 实现 Bitemporal Claim Ledger 与 Support Closure

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W2`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T20` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 Bitemporal Claim Ledger 与 Support Closure，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `ClaimLedger`

## 1. 先决条件

- [`T15`](T15-evidence-units.md)：必须存在状态 `done` 和 evidence。
- [`T06`](T06-sqlite-store.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T15.json, artifacts/task-evidence/T06.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T20
python3 scripts/taskctl.py claim T20 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T20: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T20: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`19-claims-and-authority.md`](../19-claims-and-authority.md)
- [`18-evidence-model.md`](../18-evidence-model.md)

- [`adrs/0010-bitemporal-claims.md`](../adrs/0010-bitemporal-claims.md)
- [`adrs/0012-authority-bound-provenance.md`](../adrs/0012-authority-bound-provenance.md)

## 3. 文件边界

### Create

- packages/kernel/src/claims/model.ts
- packages/kernel/src/claims/store.ts
- packages/kernel/src/claims/admit.ts
- packages/kernel/test/claim-ledger.test.ts

### Modify

- packages/storage/src/protocol.ts

### Tests

- packages/kernel/test/claim-ledger.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T20/red.txt
- artifacts/task-evidence/T20/green.txt
- artifacts/task-evidence/T20/full-gate.txt
- artifacts/task-evidence/T20.json

### 唯一允许写入集合

- packages/kernel/src/claims/model.ts
- packages/kernel/src/claims/store.ts
- packages/kernel/src/claims/admit.ts
- packages/kernel/test/claim-ledger.test.ts
- packages/storage/src/protocol.ts
- artifacts/task-evidence/T20/red.txt
- artifacts/task-evidence/T20/green.txt
- artifacts/task-evidence/T20/full-gate.txt
- artifacts/task-evidence/T20.json

修改集合外文件时必须停止，并创建 `blockers/T20-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T15 EvidenceUnits
- T06 claim tables

### Produces

- Claim append/query-as-of
- support closure
- valid/system time
- authority ceiling

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 let LLM write DB directly
- 不 delete losing facts
- 不 collapse valid time and system time

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { ClaimLedger } from "../src/claims/store.js";

describe("ClaimLedger", () => {
  it("reconstructs what was known separately from when it was valid", async () => {
    const ledger = await ClaimLedger.inMemory();
    await ledger.append(fixtureClaim({ value: "v1", validFrom: 100, systemFrom: 200 }));
    expect((await ledger.asOf({ validAt: 150, systemAt: 250 }))[0]?.value).toBe("v1");
    expect(await ledger.asOf({ validAt: 50, systemAt: 250 })).toEqual([]);
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T20
set -o pipefail
pnpm vitest run packages/kernel/test/claim-ledger.test.ts 2>&1 | tee artifacts/task-evidence/T20/red.txt
```

预期：失败原因是本任务主行为 `ClaimLedger` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export class ClaimLedger {
  async append(input: ClaimAdmission): Promise<Claim> {
    const support = await this.evidence.loadAll(input.supportIds);
    if (support.length !== input.supportIds.length) throw pcrError("PCR_CLAIM_SUPPORT_MISSING");
    const authority = minAuthority(...support.map((x) => x.authority), input.transformerCeiling);
    const claim = canonicalClaim({ ...input, authority });
    await this.store.insertClaim(claim);
    return claim;
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] claim without support rejected
- [ ] caller inference quarantined
- [ ] same claim key may have contested versions
- [ ] as-of query never revives retracted claim without policy

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/kernel/test/claim-ledger.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T20/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T20/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T20.json`：

```json
{
  "taskId": "T20",
  "status": "done",
  "allowedFiles": ["packages/kernel/src/claims/model.ts", "packages/kernel/src/claims/store.ts", "packages/kernel/src/claims/admit.ts", "packages/kernel/test/claim-ledger.test.ts", "packages/storage/src/protocol.ts", "artifacts/task-evidence/T20/red.txt", "artifacts/task-evidence/T20/green.txt", "artifacts/task-evidence/T20/full-gate.txt", "artifacts/task-evidence/T20.json"],
  "redLog": "artifacts/task-evidence/T20/red.txt",
  "greenLog": "artifacts/task-evidence/T20/green.txt",
  "fullGateLog": "artifacts/task-evidence/T20/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T20
python3 scripts/taskctl.py verify-evidence T20
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/kernel/src/claims/model.ts packages/kernel/src/claims/store.ts packages/kernel/src/claims/admit.ts packages/kernel/test/claim-ledger.test.ts packages/storage/src/protocol.ts artifacts/task-evidence/T20/red.txt artifacts/task-evidence/T20/green.txt artifacts/task-evidence/T20/full-gate.txt artifacts/task-evidence/T20.json
git commit -m "feat(t20): 实现 Bitemporal Claim Ledger 与 Support Closure"
python3 scripts/taskctl.py record-commit T20 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：Claim append/query-as-of
- [ ] 完成：support closure
- [ ] 完成：valid/system time
- [ ] 完成：authority ceiling
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T20` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- support set exact and non-empty
- source authority cannot escalate
- as-of behavior covered by table tests

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
