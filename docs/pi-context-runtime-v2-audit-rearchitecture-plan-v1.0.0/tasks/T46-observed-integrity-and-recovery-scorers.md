# T46: Observed integrity and recovery scorers

> **Agent contract:** 本任务是独立 Reviewer Gate。执行者只能修改 Allowed Files；完成前必须提供 RED、GREEN、全局 Gate 和原子 commit 证据。

**Wave:** W5  
**Depends on:** T15, T30, T40  
**Closes/advances findings:** F020, F021

## Goal

Observed integrity and recovery scorers。交付必须能被后续任务仅通过公开接口使用，不允许依赖未导出的实现细节。

## Allowed Files

- `packages/benchmark/src/scoring/integrity.ts`
- `packages/benchmark/test/scoring/integrity.test.ts`

任何其他文件变化都必须先创建 `blockers/T46-scope-expansion.md`，说明必要性、接口影响和替代方案；未批准前停止。

## Produced Evidence / Interfaces

- real pair/recovery/hash gates

```ts
export interface IntegrityScore { directiveCoverage:number; toolPairViolations:number; recoveryRate:number; deterministicHashStable:boolean; }
```

## Explicit Non-goals

- 不实现后续 Task 的语义层或优化层；
- 不修改 locked benchmark；
- 不用 fixture 常量替代 production dependency；
- 不以 mock-only test 证明 Pi 集成；
- 不手工编辑 Gate decision 或 generated report。

## Preconditions

```bash
python3 scripts/taskctl.py check-ready T46
git status --porcelain
node --version
pnpm --version
```

期望：依赖 Task 均为 `committed`，工作树干净，Node/Pnpm 与 `compat/toolchain.lock.json` 一致。

## TDD Execution

- [ ] **Step 1 — Claim task and capture preflight**

```bash
python3 scripts/taskctl.py claim T46 --owner "$PCR_AGENT_ID"
mkdir -p artifacts/task-evidence/T46
git status --porcelain > artifacts/task-evidence/T46/preflight-git.txt
pnpm --version > artifacts/task-evidence/T46/preflight-toolchain.txt
```

- [ ] **Step 2 — Write the target-specific RED test**

Create `tests/tasks/t46.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

describe("T46 Observed integrity and recovery scorers", () => {
  it("observed_integrity_and_recovery_scorers", async () => {
    const result = await runT46Fixture();
    expect(result).toMatchObject({ ok: true, task: "T46" });
  });
});
```

The fixture helper named in the test must be implemented inside the same test file or in an Allowed File; it may not return a hard-coded pass object.

- [ ] **Step 3 — Run RED and prove the intended failure**

```bash
set -o pipefail
pnpm vitest run tests/tasks/t46.test.ts 2>&1 | tee artifacts/task-evidence/T46/red.log
```

Expected: non-zero exit and an assertion/module failure directly naming the missing T46 contract. Environment or dependency installation failures are blockers, not acceptable RED.

- [ ] **Step 4 — Implement the minimal production path**

Implement exactly the public interface above. Production constructors must require every stateful dependency explicitly. A missing production port must fail at construction; no default in-memory/fake implementation is allowed outside `packages/testkit`.

- [ ] **Step 5 — Add negative and fault tests**

Add at least these classes:

1. malformed input or invalid state transition;
2. duplicate/idempotent invocation;
3. wrong workspace/session/branch scope;
4. cancellation or crash boundary when the Task performs I/O;
5. deterministic replay or two-run equality when the Task emits derived state.

- [ ] **Step 6 — Run narrow GREEN**

```bash
set -o pipefail
pnpm vitest run tests/tasks/t46.test.ts 2>&1 | tee artifacts/task-evidence/T46/green.log
```

Expected: exit 0; no skipped target test.

- [ ] **Step 7 — Run repository gates**

```bash
set -o pipefail
pnpm check:all && pnpm vitest run tests/acceptance --passWithNoTests 2>&1 | tee artifacts/task-evidence/T46/full-gate.log
node scripts/check-package-boundaries.mjs
```

Expected: all exit 0. If a pre-existing failure is encountered, record its exact commit and log in a blocker; do not suppress it.

- [ ] **Step 8 — Seal evidence and commit atomically**

```bash
python3 scripts/taskctl.py seal-evidence T46
python3 scripts/taskctl.py verify-evidence T46
git add -- packages/benchmark/src/scoring/integrity.ts packages/benchmark/test/scoring/integrity.test.ts tests/tasks/t46.test.ts artifacts/task-evidence/T46
git commit -m "feat(t46): observed integrity and recovery scorers"
python3 scripts/taskctl.py record-commit T46 HEAD
```

## Acceptance Criteria

- [ ] Public interface compiles from a downstream package.
- [ ] RED log proves the target behavior was absent.
- [ ] Narrow and full gates pass with fresh logs.
- [ ] No fixture identity, fake storage, empty claims/pointers or hard-coded success in production path.
- [ ] Allowed Files boundary is clean.
- [ ] Evidence manifest hashes every log and changed file.
- [ ] Reviewer can reproduce the result from the recorded commit.

## Reviewer Focus

Verify that the implementation closes the named finding rather than moving the constant/mock to another layer. Inspect failure semantics, source/authority propagation, stable IDs, and actual Pi/storage reachability where applicable.
