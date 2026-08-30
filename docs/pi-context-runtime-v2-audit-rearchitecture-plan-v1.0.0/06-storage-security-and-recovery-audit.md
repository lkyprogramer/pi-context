# 存储、安全与恢复审计

## 存储

Blob Store 的文件级原子写思路可保留，但当前 product 没有实例化它。SQLite Store 写 Evidence 时硬编码 session/branch/source/authority，payload 为空，不能作为权威事实层。

## 安全

- 当前 Native secret leak 结果说明“摘要器前必须 scrub/分类”，但 PCR 的 0 leak 来自完全不放 raw dump，不能证明 Evidence Store 和 Recall 的 secret policy 正确；
- tool result 被默认标记为 trusted-tool，custom/MCP/external source 没有信任策略；
- 固定 workspaceId 在接通真实存储后会造成跨项目隔离灾难；
- Recall 工具当前没有 backend，scope denial 测不到正常读取与越权读取的差异。

## 恢复

设计中的 Saga、candidate phase 和 recovery 文件存在，但 Composition Root 没有打开 store、没有 prepared/host-commit/ack 关联、没有 session_start replay。v2 要求：

- Pi JSONL 与 Runtime DB 使用 operationId + hostCorrelationId 可恢复 Saga；
- session_start 必须扫描 host entries 与 prepared rows，执行幂等 reconciliation；
- 所有 recovery 分支都通过 crash-point fault injection；
- orphan blob 只有在 receipt retention horizon 过期后才 GC。
