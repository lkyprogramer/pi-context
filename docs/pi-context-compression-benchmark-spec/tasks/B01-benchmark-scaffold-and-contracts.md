# B01 — Benchmark Scaffold and Contracts

> **Agent 执行约束：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一个 Task 对应一个 worktree、一个原子 Commit、一次独立 Review。

**依赖：** 无  
**目标：** 建立唯一公共合同，保证 TypeScript、JSON Schema、Examples 和后续 Task 使用同一字段与枚举。

## 1. 开始前检查

```bash
python3 scripts/taskctl.py check-ready B01
git status --short
node --version
pnpm --version
```

- 依赖 Task 的 Evidence JSON 和 Commit Note 必须可验证；
- 工作树必须干净；
- 若公共合同与本 Task 冲突，创建 `blockers/B01-contract-conflict.md` 并停止，不得偷改前置合同。

## 2. 唯一允许修改的文件

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `packages/benchmark-contracts/package.json`
- `packages/benchmark-contracts/src/index.ts`
- `packages/benchmark-contracts/test/contracts.test.ts`
- `scripts/check-contract-drift.mjs`

此外只允许创建：

```text
artifacts/task-evidence/B01/red.txt
artifacts/task-evidence/B01/green.txt
artifacts/task-evidence/B01/negative.txt
artifacts/task-evidence/B01/full-gate.txt
artifacts/task-evidence/B01.json
```

## 3. 输入与输出合同

### Consumes

- schemas/*.schema.json
- examples/*.example.json
- ADR-0004、ADR-0005、ADR-0007

### Produces

- RawTrace
- BoundarySnapshot
- Oracle
- ArmManifest
- CompressionArtifact
- RunManifest
- BenchmarkReport
- GateDecision
- defineBenchmarkContracts()

### 必须实现的公开接口

```ts
export interface BenchmarkContracts {
  readonly version: "1.0.0";
  parseRawTrace(value: unknown): RawTrace;
  parseOracle(value: unknown): Oracle;
  parseArmManifest(value: unknown): ArmManifest;
  parseCompressionArtifact(value: unknown): CompressionArtifact;
  parseRunManifest(value: unknown): RunManifest;
  parseBenchmarkReport(value: unknown): BenchmarkReport;
  parseGateDecision(value: unknown): GateDecision;
  canonicalJson(value: unknown): string;
  sha256Canonical(value: unknown): string;
}
export function defineBenchmarkContracts(): BenchmarkContracts;
```

禁止后续 Task 导入本 Task 的私有文件；所有共享类型从 package root 导出。

## 4. 明确非目标

- 不修改 Pi 源码或导入 Pi 私有 `src/` 路径；
- 不更新 RawTrace、Oracle、Golden、Gate margin 来适应失败输出；
- 不把网络 Provider 调用放进 unit test；
- 不实现依赖图中后续 Task 的功能；
- 不使用单一 LLM Judge 覆盖确定性失败。

## 5. TDD 执行步骤

### Step 1 — 写具体 RED

在 `packages/benchmark-contracts/test/contracts.test.ts` 写入下列核心用例，并补齐所需最小 fixture：

```ts
it("rejects an oracle with a missing sourceRef", () => {
  const c = defineBenchmarkContracts();
  expect(() => c.parseOracle({ ...validOracle, items: [{ ...validItem, sourceRefs: [] }] }))
    .toThrow(/sourceRefs/);
});

it("canonicalizes object key order without mutating input", () => {
  const c = defineBenchmarkContracts();
  const a = { z: 1, a: { y: 2, x: 3 } };
  const before = structuredClone(a);
  expect(c.sha256Canonical(a)).toBe(c.sha256Canonical({ a: { x: 3, y: 2 }, z: 1 }));
  expect(a).toEqual(before);
});
```

### Step 1.1 — 在同一测试文件定义固定 Fixture

不得使用未定义的 `fixture()` 占位函数。按下列最小数据定义 helper；可以增加字段，但不得改变给定 ID、hash 关系或预期行为。

```ts
const validItem = {
  id: "c1", kind: "constraint", canonical: "do not deploy", polarity: "must-not",
  status: "active", sourceRefs: ["u1"], visibility: "must-visible",
  risk: "hard-directive", aliases: ["不得部署"], supersededBy: null,
};
const validOracle = {
  scenarioId: "s1", oracleVersion: "1", items: [validItem],
  environmentAssertions: [], forbiddenActions: [],
};
```

### Step 2 — 验证 RED 原因

```bash
mkdir -p artifacts/task-evidence/B01
set -o pipefail
pnpm vitest run packages/benchmark-contracts/test/contracts.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B01/red.txt
```

RED 必须因为目标符号缺失或断言行为未实现而失败。`ERR_MODULE_NOT_FOUND`、凭证缺失、网络失败和 TypeScript 语法错误不算有效 RED。

### Step 3 — 实现公共接口

在 `packages/benchmark-contracts/src/index.ts` 先写类型和最小实现。实现必须遵循：

1. 从 JSON Schema 生成或手写对齐的 TypeScript 类型，不复制第二套枚举。
2. Canonical JSON：对象 key 递归按 Unicode code point 排序；数组顺序保留；禁止 NaN/Infinity/undefined。
3. 所有 parse 方法返回 deep-frozen clone。
4. check-contract-drift.mjs 比较 Schema required/enum 与 TypeScript exported const。

### Step 4 — 增加负例与故障测试

- [ ] 全部 examples 可 parse
- [ ] 未知字段被拒绝
- [ ] 空/重复 ID 被拒绝
- [ ] Canonical hash 跨 key 顺序一致
- [ ] 输入对象不被修改
- [ ] Schema/Type 枚举漂移时 CI 失败

```bash
set -o pipefail
pnpm vitest run packages/benchmark-contracts/test/contracts.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B01/negative.txt
```

### Step 5 — 窄 GREEN

```bash
set -o pipefail
pnpm vitest run packages/benchmark-contracts/test/contracts.test.ts --reporter=verbose   2>&1 | tee artifacts/task-evidence/B01/green.txt
```

### Step 6 — 全局门

```bash
set -o pipefail
{
  pnpm typecheck
  pnpm test
  node scripts/check-contract-drift.mjs
  python3 scripts/validate_artifacts.py
} 2>&1 | tee artifacts/task-evidence/B01/full-gate.txt
```

### Step 7 — Evidence Seal

`artifacts/task-evidence/B01.json` 必须记录：

```json
{
  "taskId": "B01",
  "allowedFiles": ["package.json", "pnpm-workspace.yaml", "tsconfig.base.json", "packages/benchmark-contracts/package.json", "packages/benchmark-contracts/src/index.ts", "packages/benchmark-contracts/test/contracts.test.ts", "scripts/check-contract-drift.mjs"],
  "sourceDigest": "sha256 of dependencies + spec + allowed files",
  "redLog": "artifacts/task-evidence/B01/red.txt",
  "greenLog": "artifacts/task-evidence/B01/green.txt",
  "negativeLog": "artifacts/task-evidence/B01/negative.txt",
  "fullGateLog": "artifacts/task-evidence/B01/full-gate.txt",
  "testsPassed": true,
  "typecheckPassed": true,
  "scopePassed": true
}
```

执行：

```bash
python3 scripts/taskctl.py seal-evidence B01
python3 scripts/taskctl.py verify-evidence B01
```

### Step 8 — 原子提交

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/benchmark-contracts/package.json packages/benchmark-contracts/src/index.ts packages/benchmark-contracts/test/contracts.test.ts scripts/check-contract-drift.mjs artifacts/task-evidence/B01
git commit -m "feat(b01): Benchmark Scaffold and Contracts"
python3 scripts/taskctl.py record-commit B01 HEAD
```

## 6. 完成验收

- [ ] `pnpm --filter @pcr/benchmark-contracts test` 通过
- [ ] `node scripts/check-contract-drift.mjs` 通过
- [ ] 所有公共类型只从 `packages/benchmark-contracts/src/index.ts` 导出
- [ ] RED/GREEN/Negative/Full Gate 日志来自当前 Commit；
- [ ] 允许文件范围没有越界；
- [ ] Evidence 能由 Reviewer 在新 worktree 重算。

## 7. Reviewer Focus

Reviewer 必须重跑本 Task 的窄测试，抽取至少一个随机 fixture 进行 hash/replay 验证，并确认实现没有把 Oracle expected answer、hidden continuation 或 Arm identity 泄漏给被测算法/模型。
