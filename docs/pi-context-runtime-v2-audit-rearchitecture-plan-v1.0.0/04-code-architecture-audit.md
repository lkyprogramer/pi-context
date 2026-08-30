# 代码架构与质量审计

## 可保留的资产

- `EncryptedBlobStore` 的原子 spool→fsync→rename 和 AES-GCM envelope 思路；
- reducer 纯函数与 deterministic output；
- `ContextMaterializer` 的 section/reduction 概念；
- candidate/worker 的 phase vocabulary；
- contracts 中的 source class、authority、receipt 思路；
- W2 paired runner 的独立 Pi home、同 session JSONL 拷贝和 same-cut 检查。

## 必须重写的边界

1. `apps/pi-context-runtime/src/extension.ts`：整个文件替换；
2. `packages/pi-adapter`：基于真实 Pi 0.84.3 类型重写 event codec，不再自造缩水接口；
3. `packages/storage/src/sqlite-store.ts`：去除所有 s1/main/trusted-tool 常量，改为完整 record；
4. `packages/kernel/src/directives/capture.ts`：从 marker regex 改成 exact clause + structured parser；
5. materialization message codec：不再过滤 opaque 后 positional stitch；
6. tests/e2e：fakeHost 仅留作单元测试，新增真实 SDK/RPC acceptance。

## 代码质量判断

当前小文件和 TypeScript 类型并不等于架构完成。问题集中在“端口实现是否真实”和“Composition Root 是否唯一且完整”。v2 将新增 `packages/runtime`，所有应用行为只能通过 `RuntimeSession` 访问，app 不允许直接拼装 kernel DTO。
