# T36 — 实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W3`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T36` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `verifySemanticProposal`

## 1. 先决条件

- [`T15`](T15-evidence-units.md)：必须存在状态 `done` 和 evidence。
- [`T20`](T20-claim-ledger.md)：必须存在状态 `done` 和 evidence。
- [`T21`](T21-claim-conflict-supersession.md)：必须存在状态 `done` 和 evidence。
- [`T23`](T23-continuity-ledger.md)：必须存在状态 `done` 和 evidence。
- [`T35`](T35-semantic-proposal.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T15.json, artifacts/task-evidence/T20.json, artifacts/task-evidence/T21.json, artifacts/task-evidence/T23.json, artifacts/task-evidence/T35.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T36
python3 scripts/taskctl.py claim T36 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T36: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T36: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`30-semantic-proposal-and-verifier.md`](../30-semantic-proposal-and-verifier.md)
- [`37-testing-strategy.md`](../37-testing-strategy.md)

- [`adrs/0018-semantic-proposal-not-authority.md`](../adrs/0018-semantic-proposal-not-authority.md)
- [`adrs/0012-authority-bound-provenance.md`](../adrs/0012-authority-bound-provenance.md)

## 3. 文件边界

### Create

- packages/worker/src/verifier/verifier.ts
- packages/worker/src/verifier/repairs.ts
- packages/worker/src/verifier/deterministic-floor.ts
- packages/worker/test/verifier.test.ts

### Modify

- packages/worker/src/index.ts

### Tests

- packages/worker/test/verifier.test.ts

### Test fixture：Create or Modify

- 无

### Task Evidence

- artifacts/task-evidence/T36/red.txt
- artifacts/task-evidence/T36/green.txt
- artifacts/task-evidence/T36/full-gate.txt
- artifacts/task-evidence/T36.json

### 唯一允许写入集合

- packages/worker/src/verifier/verifier.ts
- packages/worker/src/verifier/repairs.ts
- packages/worker/src/verifier/deterministic-floor.ts
- packages/worker/test/verifier.test.ts
- packages/worker/src/index.ts
- artifacts/task-evidence/T36/red.txt
- artifacts/task-evidence/T36/green.txt
- artifacts/task-evidence/T36/full-gate.txt
- artifacts/task-evidence/T36.json

修改集合外文件时必须停止，并创建 `blockers/T36-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T15 evidence
- T20/21 claims
- T23 continuity
- T35 proposal

### Produces

- VerifierReport
- ordered deterministic checks
- idempotent repairs
- deterministic quality floor

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 let same LLM self-grade final truth
- critic cannot override deterministic failure
- 不 publish report containing secret text

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { verifySemanticProposal } from "../src/verifier/verifier.js";

describe("proposal verifier", () => {
  it("rejects an assistant-authored success claim contradicted by failed tool evidence", async () => {
    const report = await verifySemanticProposal(proposalSaysTestsPassed(), fixtureStateWithFailedTest());
    expect(report.ok).toBe(false);
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_OUTCOME" }));
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T36
set -o pipefail
pnpm vitest run packages/worker/test/verifier.test.ts 2>&1 | tee artifacts/task-evidence/T36/red.txt
```

预期：失败原因是本任务主行为 `verifySemanticProposal` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export async function verifySemanticProposal(proposal: SemanticProposal, state: VerificationState): Promise<VerifierReport> {
  const gaps = [
    ...checkSchemaAndIds(proposal, state), ...checkSupportClosure(proposal, state),
    ...checkPolarityAndTime(proposal, state), ...checkAuthority(proposal, state),
    ...checkOutcomeAttestation(proposal, state), ...checkDirectiveCoverage(proposal, state)
  ];
  if (gaps.length === 0) return { ok: true, gaps: [], repaired: false };
  const repaired = applyDeterministicRepairs(proposal, gaps, state);
  return recheckOrFloor(repaired, state);
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] must-shrink
- [ ] hard directives 100%
- [ ] conflicts retained
- [ ] new concrete entities forbidden
- [ ] repair idempotent
- [ ] mutation tests remove each guard

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/worker/test/verifier.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T36/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T36/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T36.json`：

```json
{
  "taskId": "T36",
  "status": "done",
  "allowedFiles": ["packages/worker/src/verifier/verifier.ts", "packages/worker/src/verifier/repairs.ts", "packages/worker/src/verifier/deterministic-floor.ts", "packages/worker/test/verifier.test.ts", "packages/worker/src/index.ts", "artifacts/task-evidence/T36/red.txt", "artifacts/task-evidence/T36/green.txt", "artifacts/task-evidence/T36/full-gate.txt", "artifacts/task-evidence/T36.json"],
  "redLog": "artifacts/task-evidence/T36/red.txt",
  "greenLog": "artifacts/task-evidence/T36/green.txt",
  "fullGateLog": "artifacts/task-evidence/T36/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T36
python3 scripts/taskctl.py verify-evidence T36
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/worker/src/verifier/verifier.ts packages/worker/src/verifier/repairs.ts packages/worker/src/verifier/deterministic-floor.ts packages/worker/test/verifier.test.ts packages/worker/src/index.ts artifacts/task-evidence/T36/red.txt artifacts/task-evidence/T36/green.txt artifacts/task-evidence/T36/full-gate.txt artifacts/task-evidence/T36.json
git commit -m "feat(t36): 实现 结构/证据/极性/时间/Authority Verifier 与 Deterministic Floor"
python3 scripts/taskctl.py record-commit T36 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：VerifierReport
- [ ] 完成：ordered deterministic checks
- [ ] 完成：idempotent repairs
- [ ] 完成：deterministic quality floor
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T36` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- ordered gap codes
- deterministic fallback always available
- unsupported high-risk claim release gate zero

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
