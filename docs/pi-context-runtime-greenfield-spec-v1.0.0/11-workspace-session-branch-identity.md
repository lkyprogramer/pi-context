# Workspace、Session 与 Branch 身份

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

冻结物理隔离键、Host Cursor、ID 派生和目录位置，防止跨项目/分支混用。

## 2. 已冻结决策

- `workspaceId = hash(canonical cwd identity)`，不直接暴露绝对路径。
- `dataRoot = path.join(ctx.sessionManager.getSessionDir(), ".context-runtime")`。
- 每个 Workspace 物理独立 SQLite/CAS/keys。
- Session 与 Branch 在所有表上都是必填 scope。
- 跨 Workspace SQL join 和 retrieval 被架构禁止。

## 3. 物理布局

```text
<pi-session-dir>/.context-runtime/
├── runtime.sqlite
├── blobs/sha256/ab/<blobId>.bin
├── sections/sha256/ab/<sectionId>.bin
├── wal/<operationId>.json
├── spool/
├── keys/master.key
├── exports/
└── diagnostics/
```

## 4. Identity Derivation

```text
workspaceId = H("workspace:v1" || normalizedWorkspaceFingerprint)
sessionScope = H("session:v1" || workspaceId || piSessionId)
branchScope = H("branch:v1" || sessionScope || lineageHash)
```

绝对路径只保存在本地受保护元数据，不进入 telemetry、model context 或跨项目 index。

## 5. 不变量

1. 所有 retrieval query 必须携带 workspaceId/sessionId/branch policy。
2. 物理删除 Workspace 目录即可切断其数据，不依赖全局 DB 过滤。

## 6. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 7. 关联资料

- `12-storage-engine.md`
- `adrs/0006-physical-workspace-isolation.md`
