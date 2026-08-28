# 加密 Blob CAS 与密钥管理

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 raw Tool Result、section blob、加密、内容寻址、原子落盘、权限和 GC。

## 2. 已冻结决策

- plaintext hash 与 ciphertext storage ID 分域。
- AES-256-GCM；每个 blob 使用 HKDF-SHA256 派生 key 和随机 nonce。
- 默认 master key file mode 0600；可选环境变量或 OS key provider。
- 写入采用 spool → fsync → atomic rename → descriptor transaction。
- Raw evidence retention 与 materialized view retention 分开。

## 3. Blob Format

```ts
interface BlobEnvelopeV1 {
  version: 1;
  algorithm: "aes-256-gcm";
  workspaceId: string;
  plaintextHash: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}
```

`plaintextHash = SHA256("pcr:blob:v1" || canonical bytes)`。文件名使用 opaque `blobId`，不使用原始路径或工具参数。

## 4. Key Sources

优先级：

1. explicit injected KeyProvider；
2. `PI_CONTEXT_RUNTIME_MASTER_KEY`（base64 32 bytes）；
3. local `keys/master.key`（创建时 0600）；
4. 无安全 key source → strict profile not-ready。

## 5. GC

- raw evidence 受 retention/hold/user export 管理；
- section/view blobs 可滚动删除；
- GC 只删除无 canonical ref、无 active operation、超过 grace 的对象；
- 首先 dry-run 并生成 signed inventory hash。

## 6. 不变量

1. Secret/PII 不进入日志和 error message。
2. 解密必须验证 workspace、hash、tag 与 size limit。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `16-security-threat-model.md`
- `checklists/security.md`
