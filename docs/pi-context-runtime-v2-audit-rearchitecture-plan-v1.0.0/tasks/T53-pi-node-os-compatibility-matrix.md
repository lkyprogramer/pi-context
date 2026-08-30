# T53: Pi/Node/OS compatibility matrix

> **Agent contract:** 本任务是独立 Reviewer Gate。执行者只能修改 Allowed Files；完成前必须提供 RED、GREEN、全局 Gate 和原子 commit 证据。

**Wave:** W6  
**Depends on:** T05, T52  
**Closes/advances findings:** F017, F038

## Goal

Pi/Node/OS compatibility matrix。交付必须能被后续任务仅通过公开接口使用，不允许依赖未导出的实现细节。

## Allowed Files

- `compat/**`
- `.github/workflows/compatibility.yml`
- `tests/compat/**`

任何其他文件变化都必须先创建 `blockers/T53-scope-expansion.md`，说明必要性、接口影响和替代方案；未批准前停止。

## Produced Evidence / Interfaces

- supported matrix evidence

```ts
export interface CompatibilityCell { node:string; os:string; pi:string; status:"pass"|"fail"; evidence:string; }
```

## Explicit Non-goals

- 不实现后续 Task 的语义层或优化层；
- 不修改 locked benchmark；
- 不用 fixture 常量替代 production dependency；
- 不以 mock-only test 证明 Pi 集成；
- 不手工编辑 Gate decision 或 generated report。

## Preconditions

```bash
python3 scripts/taskctl.py check-ready T53
git status --porcelain
node --version
pnpm --version
```

期望：依赖 Task 均为 `committed`，工作树干净，Node/Pnpm 与 `compat/toolchain.lock.json` 一致。

## TDD Execution

- [ ] **Step 1 — Claim task and capture preflight**

```bash
python3 scripts/taskctl.py claim T53 --owner "$PCR_AGENT_ID"
mkdir -p artifacts/task-evidence/T53
git status --porcelain > artifacts/task-evidence/T53/preflight-git.txt
pnpm --version > artifacts/task-evidence/T53/preflight-toolchain.txt
```

- [ ] **Step 2 — Write the target-specific RED test**

Create `tests/tasks/t53.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

describe("T53 Pi/Node/OS compatibility matrix", () => {
  it("pi_node_os_compatibility_matrix", async () => {
    const result = await runT53Fixture();
    expect(result).toMatchObject({ ok: true, task: "T53" });
  });
});
```

The fixture helper named in the test must be implemented inside the same test file or in an Allowed File; it may not return a hard-coded pass object.

- [ ] **Step 3 — Run RED and prove the intended failure**

```bash
set -o pipefail
pnpm vitest run tests/tasks/t53.test.ts 2>&1 | tee artifacts/task-evidence/T53/red.log
```

Expected: non-zero exit and an assertion/module failure directly naming the missing T53 contract. Environment or dependency installation failures are blockers, not acceptable RED.

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
pnpm vitest run tests/tasks/t53.test.ts 2>&1 | tee artifacts/task-evidence/T53/green.log
```

Expected: exit 0; no skipped target test.

- [ ] **Step 7 — Run repository gates**

```bash
set -o pipefail
pnpm check:all && pnpm vitest run tests/acceptance --passWithNoTests 2>&1 | tee artifacts/task-evidence/T53/full-gate.log
node scripts/check-package-boundaries.mjs
```

Expected: all exit 0. If a pre-existing failure is encountered, record its exact commit and log in a blocker; do not suppress it.

- [ ] **Step 8 — Seal evidence and commit atomically**

```bash
python3 scripts/taskctl.py seal-evidence T53
python3 scripts/taskctl.py verify-evidence T53
git add -- compat/** .github/workflows/compatibility.yml tests/compat/** tests/tasks/t53.test.ts artifacts/task-evidence/T53
git commit -m "feat(t53): pi/node/os compatibility matrix"
python3 scripts/taskctl.py record-commit T53 HEAD
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
