# T07 — 实现加密 Content-addressed Blob Store 与 Key Provider

> **执行协议：** 必须遵守 [`EXECUTION-PROTOCOL.md`](EXECUTION-PROTOCOL.md)。一次只执行本任务；不得依赖包外 Skill、私有记忆或未列出的宿主源码。

**Wave：** `W0`  
**状态输入：** `.pcr/task-status.jsonl` 中 `T07` 必须为 `pending` 或已解除 `blocked`  
**目标：** 实现加密 Content-addressed Blob Store 与 Key Provider，产生可由后续任务依赖的独立、已测试提交。  
**主符号：** `EncryptedBlobStore`

## 1. 先决条件

- [`T02`](T02-canonical-contracts.md)：必须存在状态 `done` 和 evidence。
- [`T03`](T03-canonical-encoding-hashes.md)：必须存在状态 `done` 和 evidence。

依赖 Evidence：`artifacts/task-evidence/T02.json, artifacts/task-evidence/T03.json`。

开始前运行：

```bash
git status --short
python3 scripts/validate_task_graph.py
python3 scripts/taskctl.py check-ready T07
python3 scripts/taskctl.py claim T07 --owner "${PCR_AGENT_ID:?set PCR_AGENT_ID}"
```

预期：工作树无非本任务变更；`check-ready` 输出 `T07: ready` 或同一 owner 的 resume 状态；`claim` 输出 `T07: in-progress owner=...`。

## 2. 必读规格与 ADR

- [`13-blob-cas-and-key-management.md`](../13-blob-cas-and-key-management.md)
- [`32-security-threat-model.md`](../32-security-threat-model.md)

- [`adrs/0008-encrypted-content-addressed-blobs.md`](../adrs/0008-encrypted-content-addressed-blobs.md)
- [`adrs/0006-physical-workspace-isolation.md`](../adrs/0006-physical-workspace-isolation.md)

## 3. 文件边界

### Create

- packages/storage/src/blob-store.ts
- packages/storage/src/crypto.ts
- packages/storage/src/key-provider.ts
- packages/storage/test/blob-store.test.ts

### Modify

- packages/storage/src/index.ts

### Tests

- packages/storage/test/blob-store.test.ts

### Test fixture：Create or Modify

- packages/storage/test/support.ts

### Task Evidence

- artifacts/task-evidence/T07/red.txt
- artifacts/task-evidence/T07/green.txt
- artifacts/task-evidence/T07/full-gate.txt
- artifacts/task-evidence/T07.json

### 唯一允许写入集合

- packages/storage/src/blob-store.ts
- packages/storage/src/crypto.ts
- packages/storage/src/key-provider.ts
- packages/storage/test/blob-store.test.ts
- packages/storage/src/index.ts
- packages/storage/test/support.ts
- artifacts/task-evidence/T07/red.txt
- artifacts/task-evidence/T07/green.txt
- artifacts/task-evidence/T07/full-gate.txt
- artifacts/task-evidence/T07.json

修改集合外文件时必须停止，并创建 `blockers/T07-contract-change.md`；不得顺手重构。

## 4. 接口合同

### Consumes

- T02 BlobId/error types
- T03 domainHash/Clock

### Produces

- `BlobStore.put/read/verify/gcCandidate`
- AES-256-GCM envelope
- workspace-derived key domain
- test key provider

后续任务只能依赖上面的公开产物，不得读取本任务内部实现文件绕过 API。

## 5. 明确不做

- 不 embed secret values into blob ID
- 不 implement OS keychain adapters beyond interface/test provider
- 不 index decrypted raw text here

## 6. TDD 执行步骤

- [ ] **Step 1：创建失败测试**

把以下测试写入首个 Tests 文件。Snippet 中引用的 fixture 必须在本任务允许的 support 文件或测试文件自身定义；不得借用未来任务代码：

```ts
import { describe, expect, it } from "vitest";
import { createTestBlobStore } from "./support.js";

describe("EncryptedBlobStore", () => {
  it("deduplicates identity while using authenticated randomized ciphertext", async () => {
    const store = await createTestBlobStore();
    const a = await store.put(Buffer.from("full tool output"));
    const b = await store.put(Buffer.from("full tool output"));
    expect(a.blobId).toBe(b.blobId);
    expect(await store.read(a.blobId)).toEqual(Buffer.from("full tool output"));
    await expect(store.read("blob_" + "0".repeat(64))).rejects.toMatchObject({ code: "PCR_BLOB_NOT_FOUND" });
  });
});
```

- [ ] **Step 2：运行 RED，确认失败原因正确**

```bash
mkdir -p artifacts/task-evidence/T07
set -o pipefail
pnpm vitest run packages/storage/test/blob-store.test.ts 2>&1 | tee artifacts/task-evidence/T07/red.txt
```

预期：失败原因是本任务主行为 `EncryptedBlobStore` 尚未实现、尚未导出或断言未满足；不能是语法错误、依赖安装失败或无关测试失败。

- [ ] **Step 3：实现最小公共接口**

实现必须从以下骨架开始；可以拆成本任务 Create 列出的专责文件，不能增加新的公共概念：

```ts
export class EncryptedBlobStore {
  async put(plain: Uint8Array): Promise<{ blobId: string; bytes: number }> {
    const blobId = `blob_${domainHash("blob", Buffer.from(plain).toString("base64"))}`;
    if (!(await this.exists(blobId))) {
      const envelope = await encryptAesGcm(plain, await this.keys.workspaceKey(), blobId);
      await atomicWrite(this.pathOf(blobId), envelope);
    }
    return { blobId, bytes: plain.byteLength };
  }
  async read(blobId: string): Promise<Uint8Array> {
    return decryptAesGcm(await readFile(this.pathOf(blobId)), await this.keys.workspaceKey(), blobId);
  }
}
```

- [ ] **Step 4：补齐必要负例和边界测试**

- [ ] ciphertext bit flip fails authentication
- [ ] key unavailable blocks ready
- [ ] file permissions verified on POSIX
- [ ] GC never deletes referenced blob

- [ ] **Step 5：运行窄 GREEN**

```bash
set -o pipefail
{
  pnpm vitest run packages/storage/test/blob-store.test.ts
  pnpm --filter ./packages/** typecheck
} 2>&1 | tee artifacts/task-evidence/T07/green.txt
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
} 2>&1 | tee artifacts/task-evidence/T07/full-gate.txt
```

所有命令必须退出码 0；禁止用 `--passWithNoTests`、跳过测试或更新 golden 规避失败。

- [ ] **Step 7：生成并封存 Task Evidence**

创建 `artifacts/task-evidence/T07.json`：

```json
{
  "taskId": "T07",
  "status": "done",
  "allowedFiles": ["packages/storage/src/blob-store.ts", "packages/storage/src/crypto.ts", "packages/storage/src/key-provider.ts", "packages/storage/test/blob-store.test.ts", "packages/storage/src/index.ts", "packages/storage/test/support.ts", "artifacts/task-evidence/T07/red.txt", "artifacts/task-evidence/T07/green.txt", "artifacts/task-evidence/T07/full-gate.txt", "artifacts/task-evidence/T07.json"],
  "redLog": "artifacts/task-evidence/T07/red.txt",
  "greenLog": "artifacts/task-evidence/T07/green.txt",
  "fullGateLog": "artifacts/task-evidence/T07/full-gate.txt",
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
python3 scripts/taskctl.py seal-evidence T07
python3 scripts/taskctl.py verify-evidence T07
```

`sourceDigest` 不包含 Evidence JSON 自身，避免自引用哈希。

- [ ] **Step 8：提交一个原子 Commit，并用 Git Note 记录状态**

```bash
git add packages/storage/src/blob-store.ts packages/storage/src/crypto.ts packages/storage/src/key-provider.ts packages/storage/test/blob-store.test.ts packages/storage/src/index.ts packages/storage/test/support.ts artifacts/task-evidence/T07/red.txt artifacts/task-evidence/T07/green.txt artifacts/task-evidence/T07/full-gate.txt artifacts/task-evidence/T07.json
git commit -m "feat(t07): 实现加密 Content-addressed Blob Store 与 Key Provider"
python3 scripts/taskctl.py record-commit T07 HEAD
```

`record-commit` 只写 `refs/notes/pi-context-runtime-tasks` 和本地 `.pcr/task-status.jsonl`；不得修改已提交文件。提交后 `git status --short` 必须为空。

## 7. 验收清单

- [ ] 完成：`BlobStore.put/read/verify/gcCandidate`
- [ ] 完成：AES-256-GCM envelope
- [ ] 完成：workspace-derived key domain
- [ ] 完成：test key provider
- [ ] RED 输出证明测试在实现前因预期行为缺失而失败。
- [ ] GREEN、typecheck、边界门和 `pnpm test` 均有新鲜输出。
- [ ] 未修改允许集合之外的文件。
- [ ] Evidence `sourceDigest` 可重算。
- [ ] Git Note 将 `T07` 映射到当前提交，`.pcr/task-status.jsonl` 为 `done`。

## 8. Reviewer Focus

- plaintext hash identity is domain-separated
- nonce reuse impossible
- atomic temp-write+fsync+rename documented/tested

Reviewer 若发现合同需要变化，应拒绝本任务并建立 blocker；不得在 Review 中默许跨任务接口漂移。
